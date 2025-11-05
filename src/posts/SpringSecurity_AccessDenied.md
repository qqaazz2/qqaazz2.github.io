---
title: "Spring Security 异步踩坑记：Access Denied"
date: 2025-09-29
author: "qqaazz2"
cover: /assets/images/dreader-logo.png
tags: [SpringBoot,SpringSecurity,JWT,无状态认证,Java]
star: true
isOriginal: true
pageview: true
category:
  - Dreader Server
description: 深入解析 Spring Security 异步环境下 Access Denied 异常的根源。通过将安全上下文存储到请求 Attribute 中，完美解决异步任务结束阶段认证信息缺失的问题。
---

> **项目源码地址**：[https://github.com/qqaazz2/DReader-Server](https://github.com/qqaazz2/DReader-Server)

### 前言
在基于 SpringBoot 和 SpringSecurity 构建的无状态认证系统中，通过 JWT + Redis 的组合实现了轻量而高效的用户认证。然而，在引入 SSE 进行服务端推送时，我遇到了一个棘手的问题：客户端关闭 SSE 连接竟会导致服务端抛出授权异常。本文将复盘这一问题的始末，并分享我的解决思路。

### 背景
DReader-Server 作为DReader的核心后端服务，其技术选型旨在实现高性能与高扩展性。认证层面我没有使用传统的 Session 模式，转向基于 JWT 的无状态认证方案，并利用 Redis 存储 JWT，以此来确保服务的横向扩展能力。每一次用户请求都通过验证 JWT 来确认身份，无需在服务端保留任何会话信息。

为了给用户带来更实时的交互体验，我引入了 SSE (Server-Sent Events) 技术实现消息的主动推送。但在测试过程中，一个看似不相关的异常频繁出现——当客户端主动断开 SSE 连接时，服务端日志中会赫然记录一条用户授权失败的异常。这非常令人困惑，因为连接的关闭本应是一个常规操作，不应与权限验证逻辑产生冲突。

本着技术分享和交流的精神，我将在这篇文章里，分享我对这个问题的分析和解决思路。我将尝试剖析为何一个简单的连接关闭操作会触发 Spring Security 的认证流程，并给出我最终采用的解决方案。其中或许有考虑不周之处，希望能起到一个抛砖引玉的作用，非常欢迎大家一起交流探讨。

### 问题的发生
在实现书籍扫描这个功能时，我想要将后台扫描书籍的异步任务情况实时发给客户端。对于怎么实现，我当时也纠结了一阵子，主要是在轮询、WebSocket 和 SSE 这三个技术之间做选择。

我的思考过程大概是这样的：首先，WebSocket 功能很强，但对我这个只需要服务器单向推送消息的场景来说，有点“用力过猛”了，所以暂时没考虑。

剩下的轮询和 SSE，虽然都是基于 HTTP，但差别还挺大的。轮询需要前端不停地发请求，即便没什么新消息也得去问，感觉资源开销上不太划算。而 SSE 就不一样了，它只需要建立一次连接，之后服务器就能随时把新数据推过来，这样既省事又高效。

在我看来，SSE 恰好平衡了性能开销和实现复杂度，非常适合我当前的这个需求。因此，我最终选择了它来向客户端推送扫描状态，这样用户就能比较实时地了解到任务的执行情况了。

基于上述考虑，我在DReader-Server中尝试采用SSE来实现任务状态的实时推送。在实现过程中，我将SseEmitter作为静态资源进行保存，然后通过异步任务将消息推送给客户端。
<details>
<summary>📄查看代码</summary>

```java
@Slf4j
@Component
public class ScanningSseClient {
    private static SseEmitter sseEmitter;
    public SseEmitter createSse() {
        sseEmitter = new SseEmitter(0l);
        sseEmitter.onCompletion(() -> {
            log.info("结束Sse连接");
        });
        sseEmitter.onTimeout(() -> {
            log.info("Sse连接超时");
        });
        sseEmitter.onError(
                throwable -> {
                    try {
                        log.info("Sse连接异常,{}", throwable.toString());
                    } catch (Exception e) {
                        throw new BizException("4000", "Sse服务连接错误");
                    }
                }
        );
        return sseEmitter;
    }

    @Async
    public void sendMessage() {
        try {
            while (AsyncTask.taskMap.size() > 0) {
                sseEmitter.send(SseEmitter.event()
                        .id("task-running")
                        .name("status")
                        .data("队列任务执行中，请稍候..."));
                Thread.sleep(5000);
            }
            sseEmitter.send(SseEmitter.event()
                    .id("task-finished")
                    .name("status")
                    .data("所有任务均已完成，系统空闲"));
            Thread.sleep(5000);
            // 先清理上下文再关闭 SSE
            SecurityContextHolder.clearContext();
            sseEmitter.complete();

            log.info("SSE 已完成任务并关闭连接");
        } catch (Exception e) {
            throw new BizException("4000", "Sse服务连接错误");
        }
    }


    public void closeSse() {
        sseEmitter.complete();
    }
}
```
</details>

在SseController控制器中的createSse接口是这样执行的首先调用ScanningSseClient类中的createSse方法创建一个SseEmitter类，接着开始调用sendMessage这个异步方法开始向前端推送数据。

<details>
<summary>📄查看代码</summary>

```java
@Slf4j
@RestController
@RequestMapping("/sse")
public class SseController {
    @Resource
    ScanningSseClient sseClient;

    @GetMapping("/createSse")
    public SseEmitter createSse(){
        log.info("asdasdasd");
        SseEmitter sseEmitter = sseClient.createSse();
        sseClient.sendMessage();
        return sseEmitter;
    }

    @GetMapping("/closeSse")
    public void closeConnect(){
        sseClient.closeSse();
    }
}
```
</details>

后端实现完成后，接下来自然就是前端的工作了。经过一番开发，我也成功使用Overlay实现了客户端通知功能——一个可以从侧边弹出、可以手动关闭的常驻通知组件。本以为整个功能到这里就该结束了，谁知就在我测试点击关闭按钮时，意外发现了一个严重问题：Spring Security竟然抛出了一个角色权限认证的异常。

出现这个权限问题的时候让我有点触不及防，接着我开始了排错误，首先查看了前端的请求和后端的日志，发现每当我手动关闭通知组件时，也就是通知后端关闭这个长连接的时候，后端就会抛出权限认证异常。起初我以为是前端多发了什么奇怪的请求，但排查网络请求后并没有发现异常。当我百思不得其解的时候我去Spring Security翻阅到这样一篇文章 [Session Management Migrations](https://docs.spring.io/spring-security/reference/migration/servlet/session-management.html)

![图片](/assets/images/SpringSecurity.png)

这里说明了在Spring Security 6默认情况下安全上下文(SecurityContext)是不会默认持久化存储的，所以有必要的时候需要显式的给将安全上下文存储到SecurityContextRepository中，所以在项目中使用了无状态的情况下这个这个初始拿到的SecurityContextHolder.getContext()去获取的上下文在不他做显式存储的情况下永远获取出来的都是一个空值。

所以在这个调用控制器的createSee方法的时候这个流程就是`REQUEST Dispatch` -> 异步任务 -> `ASYNC Dispatch`这个样子。

### 初始请求阶段
1. 首先初次请求的时候会按照正常的`Security`拦截链走一次
2. 因为配置了`Security`是无状态的，所以`SecurityContextHolder`在`SecurityContextRepository`获取这个`安全上下文(SecurityContext)`的时候发现是为空值
3. 这个时候就会走到这个JWT的验证器判断当前的用户是否已经登录、Token是否过期等操作，如果是成功执行到最后就会将这个User变为`UsernamePasswordAuthenticationToken`类放入新创建的安全上下文中，最后填充到`SecurityContextHolder`中
4. 在所有的这些拦截器都完成后来到控制器，并调用`createSse`方法
5. 在`createSse`方法创建了并返回了一个`SseEmitter`对象之后，就会告诉这个Servlet容器（Tomcat）：“这个请求需要转入异步模式，请保持连接，但你可以把我当前的线程回收了”。到此为止，这个初始请求流程就结束了，处理初次请求的Servlet线程被释放回线程池。

### 后台异步任务
1. 这个时候长连接已经成功链接了，这里在循环条件满足的情况下会一直向前端推送数据
2. 因为这个`seedMessage`方法使用了`@Aysnc`注解所以，Spring会从一个独立的后台线程组中拿出一个线程来执行这个异步任务

### 异步任务结束
1. 当这个`seedMessage`方法中循环不满足条件了，从循环中跑了出来，然后就会要调用这个`sseEmitter.complete()`方法来结束掉Sse链接
2. 为了处理这个长连接的手尾，Servlet容器会创建一个新的`ASYNC Dispatch`，然后创建一个线程来处理这个`ASYNC Dispatch`
3. 在这个新线程中会重新走一遍这个拦截链，但是因为这个JWT拦截器是继承自`OncePerRequestFilter`所以在这一次的拦截链中而被跳过
4. 由于到JWT拦截器被跳过了，所以到最后这个`安全上下文(SecurityContext)`都为空值
5. 最终当请求到达这个授权过滤器的时候，会因为安全上下文是空值而抛出这个Access Denied异常。

在了解了上面的流程之后，就会发现问题其实出现在这个异步任务结束阶段的，因为在他最后要使用安全上下文的这个值依旧为空所以抛出了Access Denied异常，而解决方法就是将这个上下文存储下来给这个异步任务结束阶段使用，Spring Security提供了一个`RequestAttributeSecurityContextRepository`类，它可以将传入的值给放到请求的Attribute并传递下去，我使用了这个类并将安全上下文给他存进去，然后在异步任务结束阶段`SecurityContextHolder`在`SecurityContextRepository`获取安全上下文的时候，就可以将初始请求阶段放入这个`RequestAttributeSecurityContextRepository`里面的安全上下文提取出来直接使用，也不会有Access Denied异常在被抛出。

![JWT拦截器中使用RequestAttributeSecurityContextRepository](/assets/images/JWT.png "JWT拦截器中使用RequestAttributeSecurityContextRepository")

至此，这个莫名其妙的Access Denied异常总算是被解决了。回顾整个过程，核心还是在于理解 Spring Security 的上下文管理机制，特别是 SecurityContextHolder 和 SecurityContextRepository 是如何协同工作的。

希望我踩过的这个“坑”和对应的解决方案，能为你节省一些宝贵的调试时间。

感谢观看（阅读）！
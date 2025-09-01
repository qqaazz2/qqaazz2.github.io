import { defineUserConfig } from "vuepress";

import theme from "./theme.js";

export default defineUserConfig({
  base: "/",
  locales: {
    "/": {
      lang: "en-US",
      title: "Qqaazz2's Blog",
      description: "Bug Log: Why My Code Broke Again — quick notes on what went wrong and how not to trip over the same banana peel next time",
    },
    "/zh/": {
      lang: "zh-CN",
      title: "Qqaazz2的博客",
      description: "「掉坑日记：代码怎么又崩了」—— 随手记下问题，顺便想想下次怎么不踩同一块香蕉皮",
    },
  },

  theme,

  // Enable it with pwa
  // shouldPrefetch: false,
});

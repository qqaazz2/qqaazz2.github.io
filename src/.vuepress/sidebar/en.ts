import { sidebar } from "vuepress-theme-hope";

export const enSidebar = sidebar({
  "/": [
    "",
    {
      text: "article",
      icon: "book",
      prefix: "posts/",
      children: "structure",
    },
    "intro",

  ],
});

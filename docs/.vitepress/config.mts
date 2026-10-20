import { defineConfig } from "vitepress";

export default defineConfig({
  title: "Hypit",
  description: "Author and render video from semantic sources, with an Agent or from the CLI.",
  markdown: {
    languageAlias: {
      svml: "xml",
      svrun: "xml",
      svs: "css",
    },
  },
  themeConfig: {
    nav: [
      { text: "Quickstart", link: "/quickstart" },
      { text: "CLI", link: "/guide/cli-quickstart" },
      { text: "Guide", link: "/guide/agents" },
    ],
    sidebar: {
      "/quickstart": [
        { text: "Quickstart for Agent users", link: "/quickstart" },
        {
          text: "Production",
          items: [
            { text: "Runs and Builds", link: "/quickstart/run" },
            { text: "Script", link: "/quickstart/script" },
            { text: "Composition", link: "/quickstart/composition" },
            { text: "Preview and Studio", link: "/quickstart/preview" },
            { text: "Images", link: "/quickstart/images" },
            { text: "Generation", link: "/quickstart/generation" },
            { text: "Timing", link: "/quickstart/timing" },
            { text: "Tracks", link: "/quickstart/tracks" },
            { text: "Styles", link: "/quickstart/styles" },
          ],
        },
      ],
      "/guide": [
        {
          text: "Get started",
          items: [
            { text: "Use Hypit in your Agent", link: "/guide/agents" },
            { text: "Making videos with an Agent", link: "/guide/skill" },
            { text: "CLI quickstart", link: "/guide/cli-quickstart" },
          ],
        },
        {
          text: "Services",
          items: [
            { text: "Models and Providers", link: "/guide/providers" },
            { text: "Model and deployment services", link: "/guide/service-partners" },
            { text: "Runtime and credentials", link: "/guide/runtime" },
          ],
        },
        {
          text: "Authoring",
          items: [
            { text: "Conventions", link: "/guide/conventions" },
            { text: "Author packages", link: "/guide/author-packages" },
            { text: "Component anatomy", link: "/guide/component-anatomy" },
            { text: "Package layout", link: "/guide/packages" },
          ],
        },
        {
          text: "Develop",
          items: [
            { text: "Develop", link: "/guide/develop" },
            { text: "Testing", link: "/guide/testing" },
            { text: "Studio companion architecture", link: "/guide/studio-companion-architecture" },
            { text: "Studio temporal windows", link: "/guide/studio-temporal-windows" },
          ],
        },
      ],
    },
  },
});

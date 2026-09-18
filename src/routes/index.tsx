import { createFileRoute } from "@tanstack/react-router";
import CallUApp from "@/components/callu-app";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Call u — Free calls to anyone, anywhere" },
      {
        name: "description",
        content:
          "Call u is a free calling app: crystal-clear voice calls to 60+ countries with no paywall and no minutes to track.",
      },
      { property: "og:title", content: "Call u — Free calls to anyone, anywhere" },
      {
        property: "og:description",
        content:
          "Crystal-clear free calls to 60+ countries, no paywall, no minutes to track.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CallUApp,
});

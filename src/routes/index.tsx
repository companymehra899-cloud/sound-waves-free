import { createFileRoute } from "@tanstack/react-router";
import SpeakPractice from "@/components/speak-practice";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Call u — Live English speaking practice calls" },
      {
        name: "description",
        content:
          "Call u pairs you instantly with another learner for a free, direct voice call so you can practice speaking English out loud.",
      },
      { property: "og:title", content: "Call u — Live English speaking practice calls" },
      {
        property: "og:description",
        content:
          "Get matched with a real partner in seconds and practice spoken English on a free peer-to-peer voice call.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SpeakPractice,
});

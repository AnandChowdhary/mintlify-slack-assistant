import { Hono } from "hono";
import { SlackApp } from "slack-cloudflare-workers";
import { SlackMessageHandler } from "./handlers/slack";
import { CloudflareBindings } from "./types";

const app = new Hono<{ Bindings: CloudflareBindings }>();

app.get("/", (c) => {
  return c.text("Hello Hono!");
});

// Slack events endpoint
app.all("/slack/events", async (c) => {
  const env = {
    ...c.env,
    SLACK_BOT_TOKEN: c.env.SLACK_BOT_USER_OAUTH_TOKEN,
  };
  const slackApp = new SlackApp({ env } as any);
  const handler = new SlackMessageHandler(c.env);

  // Handle app_mention events
  slackApp.event("app_mention", async ({ payload, context }) => {
    const messageText = await handler.fetchThreadHistory(payload, context);

    await handler.handleMessage({
      text: messageText,
      channel: payload.channel,
      thread_ts: payload.thread_ts,
      ts: payload.ts,
      context,
    });
  });

  // Handle message events in threads
  slackApp.event("message", async ({ payload, context }) => {
    // Type guard to check if this is a regular message with text
    if (
      "text" in payload &&
      payload.text &&
      "thread_ts" in payload &&
      payload.thread_ts
    ) {
      // Skip if this is a bot message
      if ("subtype" in payload && payload.subtype === "bot_message") {
        return;
      }

      // Check if bot has participated in this thread
      const kvKey = `thread:${payload.channel}:${payload.thread_ts}`;
      const topicId = await c.env.KV.get(kvKey);

      // Only respond if we have a topic ID for this thread (meaning bot has responded before)
      if (topicId) {
        await handler.handleMessage({
          text: payload.text,
          channel: payload.channel,
          thread_ts: payload.thread_ts,
          ts: payload.ts,
          context,
        });
      }
    }
  });

  // Run the Slack app handler
  return await slackApp.run(c.req.raw, c.executionCtx);
});

export default app;

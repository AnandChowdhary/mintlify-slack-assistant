import { Hono } from "hono";
import { SlackApp } from "slack-cloudflare-workers";

interface CloudflareBindings {
  SLACK_BOT_USER_OAUTH_TOKEN: string;
  MINTLIFY_PUBLIC_ASSISTANT_API_KEY: string;
  KV: KVNamespace;
}

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

  // Handle app_mention events
  slackApp.event("app_mention", async ({ payload, context }) => {
    const { text, channel, thread_ts, ts } = payload;
    const threadId = thread_ts || ts;
    const kvKey = `thread:${channel}:${threadId}`;
    
    try {
      // Check if this thread already has a topic ID
      let topicId = await c.env.KV.get(kvKey);
      
      // Create a new topic if one doesn't exist
      if (!topicId) {
        console.log("Creating new topic for thread:", kvKey);
        const topicResponse = await fetch("https://api-dsc.mintlify.com/v1/chat/topic", {
          method: "POST",
          headers: { 
            Authorization: `Bearer ${c.env.MINTLIFY_PUBLIC_ASSISTANT_API_KEY}`, 
            "Content-Type": "application/json" 
          },
        });
        
        if (!topicResponse.ok) {
          const errorText = await topicResponse.text();
          console.error("Failed to create topic:", topicResponse.status, errorText);
          await context.say({
            text: `Failed to create conversation (${topicResponse.status}): ${errorText}`,
            thread_ts: threadId,
          });
          return;
        }
        
        const topicData = await topicResponse.json() as { topicId: string };
        topicId = topicData.topicId;
        
        // Store the mapping in KV
        await c.env.KV.put(kvKey, topicId!, { expirationTtl: 86400 * 7 }); // Expire after 7 days
      }
      
      // Send the message to the Mintlify API
      console.log("Sending message to topic:", topicId);
      const messageResponse = await fetch("https://api-dsc.mintlify.com/v1/chat/message", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${c.env.MINTLIFY_PUBLIC_ASSISTANT_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          topicId: topicId,
          message: text.replace(/<@[A-Z0-9]+>/g, '').trim(), // Remove bot mention
        }),
      });
      
      if (!messageResponse.ok) {
        const errorText = await messageResponse.text();
        console.error("Failed to send message:", messageResponse.status, errorText);
        await context.say({
          text: `Failed to process message (${messageResponse.status}): ${errorText}`,
          thread_ts: threadId,
        });
        return;
      }
      
      const responseData = await messageResponse.text();
      const [displayText] = responseData.split("||");
      
      // Reply in the thread
      await context.say({
        text: displayText,
        thread_ts: threadId,
      });
      
    } catch (error) {
      console.error("Error processing message:", error);
      await context.say({
        text: `Error: ${error instanceof Error ? error.message : String(error)}`,
        thread_ts: threadId,
      });
    }
  });

  // Run the Slack app handler
  return await slackApp.run(c.req.raw, c.executionCtx);
});

export default app;

import { Hono } from "hono";
import { SlackApp } from "slack-cloudflare-workers";

const MINTLIFY_PUBLIC_ASSISTANT_API_KEY = "mint_dsc_3ZjkTEgxnSv9oVS8HCMV3xkC";
interface CloudflareBindings {
  SLACK_BOT_USER_OAUTH_TOKEN: string;
  MINTLIFY_PUBLIC_ASSISTANT_API_KEY: string;
  KV: KVNamespace;
}

function markdownToSlack(markdown: string): string {
  // First convert bold (must be done before italic to avoid conflicts)
  let text = markdown
    .replace(/\*\*(.+?)\*\*/g, "*$1*")
    .replace(/__(.+?)__/g, "*$1*");

  // Then convert headers
  text = text
    .replace(/^### (.+)$/gm, "*$1*")
    .replace(/^## (.+)$/gm, "*$1*")
    .replace(/^# (.+)$/gm, "*$1*");

  // Convert the rest
  text = text
    // Strikethrough
    .replace(/~~(.+?)~~/g, "~$1~")
    // Code blocks
    .replace(/```[\s\S]*?```/g, (match) => {
      return match.replace(/```(\w+)?\n?/g, "```");
    })
    // Inline code
    .replace(/`(.+?)`/g, "`$1`")
    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "<$2|$1>")
    // Unordered lists
    .replace(/^[\*\-] (.+)$/gm, "• $1")
    // Ordered lists
    .replace(/^\d+\. (.+)$/gm, "• $1")
    // Blockquotes
    .replace(/^> (.+)$/gm, "> $1")
    // Remove excessive newlines
    .replace(/\n{3,}/g, "\n\n");

  return text;
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
        const topicResponse = await fetch(
          "https://api-dsc.mintlify.com/v1/chat/topic",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${MINTLIFY_PUBLIC_ASSISTANT_API_KEY}`,
              "Content-Type": "application/json",
            },
          }
        );

        if (!topicResponse.ok) {
          const errorText = await topicResponse.text();
          console.error(
            "Failed to create topic:",
            topicResponse.status,
            errorText
          );
          await context.say({
            text: `Failed to create conversation (${topicResponse.status}): ${errorText}`,
            thread_ts: threadId,
          });
          return;
        }

        const topicData = (await topicResponse.json()) as { topicId: string };
        topicId = topicData.topicId;

        // Store the mapping in KV
        await c.env.KV.put(kvKey, topicId!, { expirationTtl: 86400 * 7 }); // Expire after 7 days
      }

      // Send the message to the Mintlify API
      console.log("Sending message to topic:", topicId);
      const messageResponse = await fetch(
        "https://api-dsc.mintlify.com/v1/chat/message",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${MINTLIFY_PUBLIC_ASSISTANT_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            topicId: topicId,
            message: text.replace(/<@[A-Z0-9]+>/g, "").trim(), // Remove bot mention
          }),
        }
      );

      if (!messageResponse.ok) {
        const errorText = await messageResponse.text();
        console.error(
          "Failed to send message:",
          messageResponse.status,
          errorText
        );
        await context.say({
          text: `Failed to process message (${messageResponse.status}): ${errorText}`,
          thread_ts: threadId,
        });
        return;
      }

      const responseData = await messageResponse.text();
      const [displayText, sourcesRaw] = responseData.split("||");

      // Convert markdown to Slack formatting
      let slackFormattedText = markdownToSlack(displayText);

      // Parse and add sources if available
      if (sourcesRaw) {
        try {
          const sources = JSON.parse(sourcesRaw) as Array<{ url: string }>;
          if (sources && sources.length > 0) {
            const sourceLinks = sources
              .map((source, index) => `<${source.url}|[${index + 1}]>`)
              .join(" ");
            slackFormattedText += `\n\n*Sources:* ${sourceLinks}`;
          }
        } catch (e) {
          console.error("Failed to parse sources:", e);
        }
      }

      // Reply in the thread
      await context.say({
        text: slackFormattedText,
        thread_ts: threadId,
      });
    } catch (error) {
      console.error("Error processing message:", error);
      await context.say({
        text: `Error: ${
          error instanceof Error ? error.message : String(error)
        }`,
        thread_ts: threadId,
      });
    }
  });

  // Run the Slack app handler
  return await slackApp.run(c.req.raw, c.executionCtx);
});

export default app;

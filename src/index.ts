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
    const isDebugMode = text.includes("[DEBUG]");
    const debugInfo: string[] = [];

    if (isDebugMode) {
      debugInfo.push("🔍 *DEBUG MODE ENABLED*");
      debugInfo.push(`Channel: ${channel}`);
      debugInfo.push(`Thread TS: ${thread_ts || "None (new thread)"}`);
      debugInfo.push(`Message TS: ${ts}`);
      debugInfo.push(`Thread ID: ${threadId}`);
      debugInfo.push(`KV Key: ${kvKey}`);
    }

    try {
      // Add eyes emoji reaction to show we're processing
      await context.client.reactions.add({
        channel: channel,
        timestamp: ts,
        name: "eyes",
      });
      
      // Check if this thread already has a topic ID
      let topicId = await c.env.KV.get(kvKey);
      
      if (isDebugMode) {
        debugInfo.push(`Existing Topic ID: ${topicId || "None (will create new)"}`);
      }

      // Create a new topic if one doesn't exist
      if (!topicId) {
        console.log("Creating new topic for thread:", kvKey);
        if (isDebugMode) {
          debugInfo.push("Creating new topic...");
        }
        
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

          // Remove eyes emoji before returning error
          await context.client.reactions.remove({
            channel: channel,
            timestamp: ts,
            name: "eyes",
          });

          await context.say({
            text: `Failed to create conversation (${topicResponse.status}): ${errorText}`,
            thread_ts: threadId,
          });
          return;
        }

        const topicData = (await topicResponse.json()) as { topicId: string };
        topicId = topicData.topicId;
        
        if (isDebugMode) {
          debugInfo.push(`Created Topic ID: ${topicId}`);
        }

        // Store the mapping in KV
        await c.env.KV.put(kvKey, topicId!, { expirationTtl: 86400 * 7 }); // Expire after 7 days
        
        if (isDebugMode) {
          debugInfo.push(`Stored in KV with 7-day TTL`);
        }
      }

      // Send the message to the Mintlify API
      console.log("Sending message to topic:", topicId);
      const cleanedMessage = text.replace(/<@[A-Z0-9]+>/g, "").replace("[DEBUG]", "").trim();
      
      if (isDebugMode) {
        debugInfo.push(`Original message: "${text}"`);
        debugInfo.push(`Cleaned message: "${cleanedMessage}"`);
        debugInfo.push(`Sending to topic: ${topicId}`);
      }
      
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
            message: cleanedMessage,
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

        // Remove eyes emoji before returning error
        await context.client.reactions.remove({
          channel: channel,
          timestamp: ts,
          name: "eyes",
        });

        await context.say({
          text: `Failed to process message (${messageResponse.status}): ${errorText}`,
          thread_ts: threadId,
        });
        return;
      }

      const responseData = await messageResponse.text();
      const [displayText, sourcesRaw] = responseData.split("||");
      
      if (isDebugMode) {
        debugInfo.push(`Response received (${responseData.length} chars)`);
        debugInfo.push(`Sources data: ${sourcesRaw ? "Yes" : "No"}`);
      }

      // Convert markdown to Slack formatting
      let slackFormattedText = markdownToSlack(displayText);

      // Parse and add sources if available
      if (sourcesRaw) {
        try {
          const sources = JSON.parse(sourcesRaw) as Array<{
            link: string;
            metadata?: { title?: string };
          }>;
          if (sources && sources.length > 0) {
            if (isDebugMode) {
              debugInfo.push(`Found ${sources.length} sources`);
            }
            
            const sourceLinks = sources
              .map((source, index) => {
                const baseUrl = "https://docs.firstquadrant.ai/";
                const fullUrl = source.link.startsWith("http")
                  ? source.link
                  : baseUrl + source.link;
                return `<${fullUrl}|[${index + 1}]>`;
              })
              .join(" ");
            slackFormattedText += `\n\n${sourceLinks}`;
          }
        } catch (e) {
          console.error("Failed to parse sources:", e);
        }
      }
      
      // Add debug info to the response if in debug mode
      if (isDebugMode) {
        debugInfo.push("\n*Response sent successfully*");
        slackFormattedText = debugInfo.join("\n") + "\n\n---\n\n" + slackFormattedText;
      }

      // Reply in the thread
      await context.say({ text: slackFormattedText, thread_ts: threadId });

      // Remove the eyes emoji reaction after responding
      await context.client.reactions.remove({
        channel: channel,
        timestamp: ts,
        name: "eyes",
      });
    } catch (error) {
      console.error("Error processing message:", error);

      // Try to remove the eyes emoji even if there was an error
      try {
        await context.client.reactions.remove({
          channel: channel,
          timestamp: ts,
          name: "eyes",
        });
      } catch (removeError) {
        console.error("Failed to remove reaction:", removeError);
      }

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

import { MintlifyService } from "../services/mintlify";
import { CloudflareBindings, MessageContext } from "../types";
import { markdownToSlack } from "../utils/markdown";

export class SlackMessageHandler {
  private env: CloudflareBindings;
  private mintlify: MintlifyService;

  constructor(env: CloudflareBindings) {
    this.env = env;
    this.mintlify = new MintlifyService(env.MINTLIFY_PUBLIC_ASSISTANT_API_KEY);
  }

  private buildDebugInfo(context: MessageContext): string[] {
    const debugInfo: string[] = [];
    const { text, channel, thread_ts, ts } = context;
    const threadId = thread_ts || ts;
    const kvKey = `mintlify-thread:${channel}:${threadId}`;

    debugInfo.push("🔍 *DEBUG MODE ENABLED*");
    debugInfo.push(`Channel: ${channel}`);
    debugInfo.push(`Thread TS: ${thread_ts || "None (new thread)"}`);
    debugInfo.push(`Message TS: ${ts}`);
    debugInfo.push(`Thread ID: ${threadId}`);
    debugInfo.push(`KV Key: ${kvKey}`);

    if (text.includes("Previous conversation in this thread:")) {
      debugInfo.push("Thread history included: Yes");
    }

    return debugInfo;
  }

  private cleanMessage(text: string): string {
    return text
      .replace(/<@[A-Z0-9]+>/g, "")
      .replace("[DEBUG]", "")
      .trim();
  }

  async handleMessage(context: MessageContext): Promise<void> {
    const { text, channel, thread_ts, ts, context: slackContext } = context;
    const threadId = thread_ts || ts;
    const kvKey = `thread:${channel}:${threadId}`;
    const isDebugMode = text.includes("[DEBUG]");
    const debugInfo = isDebugMode ? this.buildDebugInfo(context) : [];

    try {
      // Add eyes emoji reaction
      await slackContext.client.reactions.add({
        channel,
        timestamp: ts,
        name: "eyes",
      });

      // Check for existing topic
      let topicId = await this.env.KV.get(kvKey);

      if (isDebugMode && debugInfo) {
        debugInfo.push(
          `Existing Topic ID: ${topicId || "None (will create new)"}`
        );
      }

      // Create topic if needed
      if (!topicId) {
        console.log("Creating new topic for thread:", kvKey);
        if (isDebugMode && debugInfo) {
          debugInfo.push("Creating new topic...");
        }

        const topicResult = await this.mintlify.createTopic();
        if ("error" in topicResult) {
          await slackContext.client.reactions.remove({
            channel,
            timestamp: ts,
            name: "eyes",
          });
          await slackContext.say({
            text: `Failed to create conversation (${topicResult.status}): ${topicResult.error}`,
            thread_ts: threadId,
          });
          return;
        }

        topicId = topicResult.topicId;
        if (isDebugMode && debugInfo) {
          debugInfo.push(`Created Topic ID: ${topicId}`);
        }

        // Store in KV
        await this.env.KV.put(kvKey, topicId, { expirationTtl: 86400 * 7 });
        if (isDebugMode && debugInfo) {
          debugInfo.push(`Stored in KV with 7-day TTL`);
        }
      }

      // Send message
      const cleanedMessage = this.cleanMessage(text);

      if (isDebugMode && debugInfo) {
        debugInfo.push(`Original message: "${text}"`);
        debugInfo.push(`Cleaned message: "${cleanedMessage}"`);
        debugInfo.push(`Sending to topic: ${topicId}`);
      }

      console.log("Sending message to topic:", topicId);
      const messageResult = await this.mintlify.sendMessage(
        topicId,
        cleanedMessage
      );

      if ("error" in messageResult) {
        await slackContext.client.reactions.remove({
          channel,
          timestamp: ts,
          name: "eyes",
        });
        await slackContext.say({
          text: `Failed to process message (${messageResult.status}): ${messageResult.error}`,
          thread_ts: threadId,
        });
        return;
      }

      // Format response
      let slackFormattedText = markdownToSlack(messageResult.text);

      if (messageResult.sources && messageResult.sources.length > 0) {
        if (isDebugMode && debugInfo) {
          debugInfo.push(`Found ${messageResult.sources.length} sources`);
        }
        const sourceLinks = this.mintlify.formatSources(messageResult.sources);
        slackFormattedText += `\n\n${sourceLinks}`;
      }

      if (isDebugMode && debugInfo) {
        debugInfo.push("\n*Response sent successfully*");
        slackFormattedText =
          debugInfo.join("\n") + "\n\n---\n\n" + slackFormattedText;
      }

      // Send response
      await slackContext.say({ text: slackFormattedText, thread_ts: threadId });

      // Remove emoji
      await slackContext.client.reactions.remove({
        channel,
        timestamp: ts,
        name: "eyes",
      });
    } catch (error) {
      console.error("Error processing message:", error);

      // Try to remove emoji
      try {
        await slackContext.client.reactions.remove({
          channel,
          timestamp: ts,
          name: "eyes",
        });
      } catch (removeError) {
        console.error("Failed to remove reaction:", removeError);
      }

      await slackContext.say({
        text: `Error: ${
          error instanceof Error ? error.message : String(error)
        }`,
        thread_ts: threadId,
      });
    }
  }

  async fetchThreadHistory(payload: any, context: any): Promise<string> {
    let messageText = payload.text;

    if (payload.thread_ts) {
      try {
        const threadMessages = await context.client.conversations.replies({
          channel: payload.channel,
          ts: payload.thread_ts,
          limit: 100,
        });

        if (threadMessages.messages && threadMessages.messages.length > 1) {
          const history = threadMessages.messages
            .filter((msg: any) => msg.ts !== payload.ts)
            .map((msg: any) => {
              const sender = msg.bot_id ? "Assistant" : "User";
              return `${sender}: ${msg.text || ""}`;
            })
            .join("\n");

          messageText = `Previous conversation in this thread:\n${history}\n\nCurrent message: ${payload.text}`;
        }
      } catch (error) {
        console.error("Failed to fetch thread history:", error);
      }
    }

    return messageText;
  }
}

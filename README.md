# ⁉️ Mintlify Slack Assistant

Slack bot that integrates with Mintlify's documentation assistant API to provide intelligent answers to your team's and customers' questions. Built with Cloudflare Workers, Hono, and TypeScript.

## ✨ Features

- **📚 Smart Documentation Search**: Leverages Mintlify's API to search through your documentation
- **🧵 Thread Context Awareness**: Maintains conversation context within Slack threads
- **💬 Natural Conversations**: Reply in threads without mentioning the bot after initial interaction
- **🔗 Source Citations**: Provides numbered source links for every answer
- **👀 Visual Feedback**: Shows "eyes" emoji while processing requests
- **🐛 Debug Mode**: Add `[DEBUG]` to messages for detailed execution information
- **⚡ Fast Response**: Built on Cloudflare Workers for edge performance

<img width="1476" height="830" alt="Screenshot of a conversation asking about adding contacts" src="https://github.com/user-attachments/assets/1f5baa88-7eda-4c1a-9721-deb672ef011e" />

## 🚀 Setup Instructions

### 📋 Prerequisites

- Cloudflare account with Workers enabled
- Slack workspace with admin access
- Mintlify API key
- Node.js 18+ and npm/yarn

### Clone and install

```bash
git clone https://github.com/AnandChowdhary/mintlify-slack-assistant
npm install
```

### Configure Slack app

1. Go to [api.slack.com/apps](https://api.slack.com/apps) and create a new app
2. Choose "From scratch" and select your workspace
3. Navigate to **OAuth & Permissions** and add these scopes:

   - `app_mentions:read` - Read messages that mention your app
   - `chat:write` - Send messages as the bot
   - `reactions:write` - Add emoji reactions
   - `reactions:read` - View emoji reactions
   - `channels:history` - View messages in public channels
   - `groups:history` - View messages in private channels
   - `im:history` - View messages in DMs
   - `mpim:history` - View messages in group DMs

4. Install the app to your workspace and copy the **Bot User OAuth Token**

### Configure event subscriptions

1. In your Slack app settings, go to **Event Subscriptions**
2. Enable Events and add your Worker URL: `https://your-worker.workers.dev/slack/events`
3. Subscribe to these bot events:
   - `app_mention` - When someone mentions your bot
   - `message.channels` - Messages in public channels
   - `message.groups` - Messages in private channels
   - `message.im` - Direct messages
   - `message.mpim` - Group direct messages

### Set environment variables

Create a `.dev.vars` file for local development:

```env
SLACK_BOT_USER_OAUTH_TOKEN=xoxb-your-token
MINTLIFY_PUBLIC_ASSISTANT_API_KEY=mint_dsc_your_key
```

### Configure Cloudflare KV

1. Create a KV namespace:

```bash
wrangler kv:namespace create "KV"
```

2. Update `wrangler.jsonc` with the namespace ID:

```json
{
  "kv_namespaces": [
    {
      "binding": "KV",
      "id": "your-namespace-id"
    }
  ]
}
```

### 6️⃣ Deploy to Cloudflare

```bash
# Deploy to production
wrangler publish

# Or deploy to a specific environment
wrangler publish --env production
```

### Configuration

#### Environment variables

| Variable                            | Description           | Required |
| ----------------------------------- | --------------------- | -------- |
| `SLACK_BOT_USER_OAUTH_TOKEN`        | Slack bot OAuth token | ✅       |
| `MINTLIFY_PUBLIC_ASSISTANT_API_KEY` | Mintlify API key      | ✅       |

#### KV storage

The bot uses Cloudflare KV to store thread-to-topic mappings with a 7-day TTL. This enables conversation continuity within threads.

### Debugging

#### Enable debug mode

Add `[DEBUG]` to any message to see:

- Channel and thread information
- KV storage operations
- API request/response details
- Message processing steps

#### Common issues

1. **Bot not responding**: Check OAuth scopes and event subscriptions
2. **No thread context**: Verify KV namespace is properly configured
3. **API errors**: Confirm Mintlify API key is valid

## 📄 License

[MIT](./LICENSE) (c) [Anand Chowdhary](https://anandchowdhary.com)

export interface CloudflareBindings {
  SLACK_BOT_USER_OAUTH_TOKEN: string;
  MINTLIFY_PUBLIC_ASSISTANT_API_KEY: string;
  KV: KVNamespace;
}

export interface MintlifySource {
  link: string;
  metadata?: { title?: string };
}

export interface MessageContext {
  text: string;
  channel: string;
  thread_ts: string | undefined;
  ts: string;
  context: any;
}

export interface DebugInfo {
  isDebugMode: boolean;
  info: string[];
}

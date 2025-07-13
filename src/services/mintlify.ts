import { MintlifySource } from "../types";

const MINTLIFY_PUBLIC_ASSISTANT_API_KEY = "mint_dsc_3ZjkTEgxnSv9oVS8HCMV3xkC";
const MINTLIFY_API_BASE = "https://api-dsc.mintlify.com/v1";

export class MintlifyService {
  private apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey ?? MINTLIFY_PUBLIC_ASSISTANT_API_KEY;
  }

  async createTopic(): Promise<
    { topicId: string } | { error: string; status: number }
  > {
    const response = await fetch(`${MINTLIFY_API_BASE}/chat/topic`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Failed to create topic:", response.status, errorText);
      return { error: errorText, status: response.status };
    }

    return await response.json();
  }

  async sendMessage(
    topicId: string,
    message: string
  ): Promise<
    | { text: string; sources?: MintlifySource[] }
    | { error: string; status: number }
  > {
    const response = await fetch(`${MINTLIFY_API_BASE}/chat/message`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        topicId,
        message,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Failed to send message:", response.status, errorText);
      return { error: errorText, status: response.status };
    }

    const responseData = await response.text();
    const [displayText, sourcesRaw] = responseData.split("||");

    let sources: MintlifySource[] | undefined;
    if (sourcesRaw) {
      try {
        sources = JSON.parse(sourcesRaw);
      } catch (e) {
        console.error("Failed to parse sources:", e);
      }
    }

    return { text: displayText, sources };
  }

  formatSources(sources: MintlifySource[]): string {
    const baseUrl = "https://docs.firstquadrant.ai/";
    const sourceLinks = sources
      .map((source, index) => {
        const fullUrl = source.link.startsWith("http")
          ? source.link
          : baseUrl + source.link;
        return `<${fullUrl}|[${index + 1}]>`;
      })
      .join(" ");
    return sourceLinks;
  }
}

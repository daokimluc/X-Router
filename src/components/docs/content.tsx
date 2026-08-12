import type { ReactNode } from "react";
import { CodeBlock } from "@/components/ui/code-block";

/** Rich content for the most important docs articles. Others fall back to a template. */
export const DOC_CONTENT: Record<string, ReactNode> = {
  "quick-start": (
    <>
      <p>
        Từ zero đến phản hồi AI đầu tiên trong dưới 5 phút. Bạn chỉ cần một API
        key và đổi base URL.
      </p>
      <h2 id="1-create-key">1. Tạo API key</h2>
      <p>
        Vào <code>/console/keys</code>, bấm tạo key, và copy giá trị dạng{" "}
        <code>sk-vexa-xxxx</code>.
      </p>
      <h2 id="2-call">2. Gọi gateway</h2>
      <CodeBlock title="python" className="mt-4">{`from openai import OpenAI

client = OpenAI(
    base_url="https://api.vexa.ai/v1",
    api_key="sk-vexa-xxxx",
)

resp = client.chat.completions.create(
    model="provider/gpt-5.4",
    messages=[{"role": "user", "content": "Hello, Vexa!"}],
)
print(resp.choices[0].message.content)`}</CodeBlock>
      <h2 id="3-monitor">3. Theo dõi</h2>
      <p>
        Token, chi phí và độ trễ hiện trong <code>/console/usage</code> theo thời
        gian thực.
      </p>
    </>
  ),

  authentication: (
    <>
      <p>
        Mọi request cần header <code>Authorization</code> với API key của bạn.
        Key được băm SHA-256 khi lưu; key upstream của provider được mã hóa
        AES-256-GCM.
      </p>
      <h2 id="header">Authorization header</h2>
      <CodeBlock title="http" className="mt-4">{`Authorization: Bearer sk-vexa-xxxx`}</CodeBlock>
      <h2 id="env">Biến môi trường</h2>
      <CodeBlock title="bash" className="mt-4">{`export OPENAI_API_KEY=sk-vexa-xxxx
export OPENAI_BASE_URL=https://api.vexa.ai/v1`}</CodeBlock>
    </>
  ),

  "chat-completions": (
    <>
      <p>
        Endpoint <code>/v1/chat/completions</code> tương thích OpenAI. Đổi{" "}
        <code>model</code> để route sang bất kỳ provider nào.
      </p>
      <h2 id="request">Request</h2>
      <CodeBlock title="curl" className="mt-4">{`curl https://api.vexa.ai/v1/chat/completions \\
  -H "Authorization: Bearer sk-vexa-xxxx" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "provider/claude-sonnet-4.6",
    "messages": [
      {"role": "system", "content": "You are helpful."},
      {"role": "user", "content": "Explain rate limiting."}
    ]
  }'`}</CodeBlock>
      <h2 id="response">Response</h2>
      <CodeBlock title="json" className="mt-4">{`{
  "id": "chatcmpl-xxxx",
  "object": "chat.completion",
  "choices": [{
    "index": 0,
    "message": { "role": "assistant", "content": "..." },
    "finish_reason": "stop"
  }],
  "usage": { "prompt_tokens": 24, "completion_tokens": 88 }
}`}</CodeBlock>
    </>
  ),

  streaming: (
    <>
      <p>
        Bật <code>stream: true</code> để nhận token theo Server-Sent Events,
        kết thúc bằng <code>data: [DONE]</code>.
      </p>
      <CodeBlock title="python" className="mt-4">{`stream = client.chat.completions.create(
    model="provider/gpt-5.4",
    messages=[{"role": "user", "content": "Count to 5"}],
    stream=True,
)
for chunk in stream:
    print(chunk.choices[0].delta.content or "", end="")`}</CodeBlock>
    </>
  ),

  "error-handling": (
    <>
      <p>Vexa trả về mã lỗi chuẩn HTTP với body JSON mô tả lỗi.</p>
      <h2 id="codes">Mã lỗi thường gặp</h2>
      <ul>
        <li>
          <code>401</code> — API key không hợp lệ hoặc thiếu.
        </li>
        <li>
          <code>402</code> — số dư ví không đủ.
        </li>
        <li>
          <code>429</code> — vượt rate limit, thử lại với backoff.
        </li>
        <li>
          <code>503</code> — provider tạm thời không khả dụng.
        </li>
      </ul>
      <CodeBlock title="json" className="mt-4">{`{
  "error": {
    "type": "insufficient_quota",
    "message": "Wallet balance too low",
    "code": 402
  }
}`}</CodeBlock>
    </>
  ),

  "claude-code": (
    <>
      <p>Route các tác vụ coding của Claude Code qua Vexa Gateway.</p>
      <CodeBlock title="terminal" className="mt-4">{`$ ANTHROPIC_BASE_URL=https://api.vexa.ai/v1 \\
  ANTHROPIC_API_KEY=sk-vexa-xxxx \\
  claude`}</CodeBlock>
    </>
  ),

  "codex-cli": (
    <>
      <p>Dùng một API key duy nhất cho Codex CLI.</p>
      <CodeBlock title="terminal" className="mt-4">{`$ OPENAI_API_KEY=sk-vexa-xxxx \\
  OPENAI_BASE_URL=https://api.vexa.ai/v1 \\
  codex "Fix the bug in main.ts"`}</CodeBlock>
    </>
  ),

  cursor: (
    <>
      <p>Cấu hình Vexa trong Cursor Settings → Models.</p>
      <CodeBlock title="cursor" className="mt-4">{`Override AI Base URL: https://api.vexa.ai/v1
API Key: sk-vexa-xxxx
Model: provider/gpt-4o`}</CodeBlock>
    </>
  ),

  "python-sdk": (
    <>
      <p>Dùng SDK OpenAI Python với base URL của Vexa.</p>
      <CodeBlock title="bash" className="mt-4">{`pip install openai`}</CodeBlock>
      <CodeBlock title="python" className="mt-4">{`from openai import OpenAI
client = OpenAI(base_url="https://api.vexa.ai/v1", api_key="sk-vexa-xxxx")`}</CodeBlock>
    </>
  ),

  "nodejs-sdk": (
    <>
      <p>Dùng SDK OpenAI Node.js với base URL của Vexa.</p>
      <CodeBlock title="bash" className="mt-4">{`npm install openai`}</CodeBlock>
      <CodeBlock title="typescript" className="mt-4">{`import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "https://api.vexa.ai/v1",
  apiKey: "sk-vexa-xxxx",
});`}</CodeBlock>
    </>
  ),
};

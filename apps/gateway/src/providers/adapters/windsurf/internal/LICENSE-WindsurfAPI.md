# Third-party code attribution

The TypeScript modules under this `internal/` directory are derived from
[`dwgx/WindsurfAPI`](https://github.com/dwgx/WindsurfAPI) (commit ported on
2026-05-14). The original source is JavaScript; this port translates the
relevant subset of modules to TypeScript and adapts them to the
`apps/gateway` runtime, but the underlying logic — protobuf wire-format
handling, gRPC HTTP/2 framing, Cascade chat flow, language-server
lifecycle — is the work of `dwgx` and contributors to that project.

Files in this directory derived from `dwgx/WindsurfAPI`:

- `proto.ts`              ← `src/proto.js`
- `grpc.ts`               ← `src/grpc.js`
- `connect.ts`            ← `src/connect.js`
- `windsurfProto.ts`      ← `src/windsurf.js` (subset)
- `lsClient.ts`           ← `src/client.js` (subset)
- `langServerManager.ts`  ← `src/langserver.js` (subset, simplified)

Modifications include: TypeScript types, integration with the gateway
logger and error model, removal of the proxy-pool / sticky-session /
dashboard / tool-emulation features that are out of scope for this
port, and a single-LS-instance manager instead of the original
multi-instance pool.

## Original license (MIT)

```
MIT License

Copyright (c) 2026 dwgx

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

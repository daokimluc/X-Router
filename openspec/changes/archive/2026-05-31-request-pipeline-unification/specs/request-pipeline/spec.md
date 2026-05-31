## ADDED Requirements

### Requirement: Shared request lifecycle across protocols

A single shared request pipeline SHALL drive both the OpenAI
(`/v1/chat/completions`) and Anthropic (`/v1/messages`) proxy routes. The pipeline
SHALL own the request lifecycle: candidate ranking and iteration, circuit-breaker
admit/resolve, concurrency and queue acquire/release, account lease, the failover
loop, usage recording, reservation settle/release, marketplace settlement hooks,
latency recording, and cleanup on every exit path. Protocol-specific behavior SHALL
be confined to encode/decode hooks, and the external request/response contract of
each route SHALL be unchanged.

#### Scenario: Identical lifecycle behavior across protocols

- **WHEN** an equivalent failure or success occurs on either the OpenAI or the Anthropic route
- **THEN** failover, reservation handling, settlement, circuit-breaker accounting, queueing, usage recording, and cleanup SHALL behave identically, differing only in protocol encode/decode

#### Scenario: External contract preserved

- **WHEN** a client calls `/v1/chat/completions` or `/v1/messages`
- **THEN** the request/response shape and status codes SHALL match the pre-refactor behavior on healthy paths

### Requirement: Uniform cleanup on every exit path

The pipeline SHALL release every acquired resource (account lease, concurrency slot,
queue slot, held spend/marketplace reservation) and resolve the circuit breaker
exactly once on every exit path, including success, terminal error, retryable
exhaustion, capacity error, mid-stream failure, and early returns (cache hit, no
provider in group, direct-account routing). No exit path SHALL leak a reservation or
strand a circuit counter.

#### Scenario: Mid-stream failure releases everything

- **WHEN** a provider stream fails after the response has started
- **THEN** the held reservation SHALL be released, failure settlement SHALL run, the lease/slots SHALL be released, and the circuit breaker SHALL be resolved — once

#### Scenario: Early return does not leak a reservation

- **WHEN** a request returns early (cache hit, no provider in group, or direct-account routing)
- **THEN** any held spend reservation SHALL be released

### Requirement: Capacity errors fail over

The pipeline SHALL treat a capacity or admission error from one candidate (no
available account, provider overloaded, circuit open) as a signal to try the next
candidate, not to abort the whole request. Only when all candidates are exhausted
SHALL the request fail, and on that failure the pipeline SHALL release all held
reservations and run failure settlement.

#### Scenario: Saturated provider fails over to the next

- **WHEN** the first candidate's pool is exhausted or its concurrency limit is hit or its circuit is open
- **THEN** the pipeline SHALL try the next candidate rather than returning an error to the client

#### Scenario: All candidates exhausted releases reservations

- **WHEN** every candidate fails or is unavailable
- **THEN** the request SHALL fail and SHALL release any held reservation and run failure settlement

### Requirement: Consistent usage and token accounting

Usage recording and token-based rate-limit accounting SHALL be applied identically on
both protocols, for both streaming and non-streaming responses. A successful response
that reports no upstream usage SHALL still be settled against an estimate (never
served free with a permanently-held reservation). Token consumption SHALL be recorded
for streaming responses on both protocols.

#### Scenario: Success without reported usage is still settled

- **WHEN** a successful response carries no upstream usage figures
- **THEN** the pipeline SHALL settle the held reservation against an estimate rather than skipping settlement

#### Scenario: Streaming tokens count toward rate limits on both protocols

- **WHEN** a streaming response completes on either protocol
- **THEN** consumed tokens SHALL be recorded toward the key's rate-limit/quota accounting

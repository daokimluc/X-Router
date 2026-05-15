export type RequestMetric = {
  method: string;
  route: string;
  statusCode: number;
  durationMs: number;
};

export type MetricsSnapshot = {
  requestsTotal: number;
  requestsByStatus: Record<string, number>;
  requestsByRoute: Record<string, number>;
  averageDurationMs: number;
};

export class MetricsService {
  private requestsTotal = 0;
  private totalDurationMs = 0;
  private readonly requestsByStatus = new Map<string, number>();
  private readonly requestsByRoute = new Map<string, number>();

  recordRequest(metric: RequestMetric): void {
    this.requestsTotal += 1;
    this.totalDurationMs += metric.durationMs;
    this.increment(this.requestsByStatus, String(metric.statusCode));
    this.increment(
      this.requestsByRoute,
      `${metric.method.toUpperCase()} ${metric.route}`
    );
  }

  snapshot(): MetricsSnapshot {
    return {
      requestsTotal: this.requestsTotal,
      requestsByStatus: Object.fromEntries(this.requestsByStatus),
      requestsByRoute: Object.fromEntries(this.requestsByRoute),
      averageDurationMs:
        this.requestsTotal === 0 ? 0 : this.totalDurationMs / this.requestsTotal
    };
  }

  toPrometheus(): string {
    const snapshot = this.snapshot();
    const lines = [
      "# HELP gateway_requests_total Total HTTP requests handled by the gateway.",
      "# TYPE gateway_requests_total counter",
      `gateway_requests_total ${snapshot.requestsTotal}`,
      "# HELP gateway_request_duration_ms_average Average HTTP request duration in milliseconds.",
      "# TYPE gateway_request_duration_ms_average gauge",
      `gateway_request_duration_ms_average ${snapshot.averageDurationMs.toFixed(3)}`
    ];

    for (const [statusCode, count] of Object.entries(snapshot.requestsByStatus)) {
      lines.push(
        `gateway_requests_by_status_total{status_code="${escapeLabel(statusCode)}"} ${count}`
      );
    }

    for (const [route, count] of Object.entries(snapshot.requestsByRoute)) {
      lines.push(
        `gateway_requests_by_route_total{route="${escapeLabel(route)}"} ${count}`
      );
    }

    return `${lines.join("\n")}\n`;
  }

  private increment(map: Map<string, number>, key: string): void {
    map.set(key, (map.get(key) ?? 0) + 1);
  }
}

function escapeLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

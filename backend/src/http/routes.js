// Declarative route table. `permission` is the RBAC permission required;
// `auth: false` marks public routes; `permission: null` means any signed-in
// user. Keeping this as data lets tests assert the whole access matrix.

export function buildRoutes(h) {
  return [
    { method: 'GET', path: '/api/ping', auth: false, handler: h.ping },
    { method: 'POST', path: '/api/auth/login', auth: false, handler: h.login },
    { method: 'GET', path: '/api/auth/me', permission: null, handler: h.me },
    { method: 'POST', path: '/api/auth/ws-ticket', permission: 'alerts:read', handler: h.wsTicket },

    { method: 'GET', path: '/api/health/summary', permission: 'health:read', handler: h.healthSummary },

    { method: 'GET', path: '/api/reports', permission: 'reports:read', handler: h.listReports },
    // must be registered before '/api/reports/:id'
    { method: 'GET', path: '/api/reports/orphaned', permission: 'reports:read', handler: h.listOrphanedReports },
    { method: 'GET', path: '/api/reports/:id', permission: 'reports:read', handler: h.getReport },
    { method: 'POST', path: '/api/reports/:id/owner', permission: 'reports:assign', handler: h.assignOwner },

    { method: 'GET', path: '/api/alerts', permission: 'alerts:read', handler: h.listAlerts },
    { method: 'POST', path: '/api/alerts/:id/ack', permission: 'alerts:ack', handler: h.ackAlert },

    { method: 'GET', path: '/api/telemetry/status', permission: 'alerts:read', handler: h.telemetryStatus },
    { method: 'POST', path: '/api/telemetry/control', permission: 'telemetry:control', handler: h.telemetryControl },
    { method: 'POST', path: '/api/telemetry/inject', permission: 'telemetry:control', handler: h.injectEvent },

    { method: 'GET', path: '/api/data-quality/anomalies', permission: 'dq:read', handler: h.listAnomalies },

    { method: 'GET', path: '/api/costs/attribution', permission: 'costs:read', handler: h.costAttribution },
    { method: 'GET', path: '/api/costs/reconciliation', permission: 'costs:read', handler: h.costReconciliation },
  ];
}

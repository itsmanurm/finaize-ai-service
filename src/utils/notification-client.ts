// Utils for sending notifications to the backend
import { config } from '../config';
import { formatCurrency } from './format';

interface NotificationPayload {
  userId: string;
  type: 'ANOMALY_PERTURBATION' | 'RECURRING_SUBSCRIPTION_DETECTED';
  message: string;
  severity?: 'success' | 'info' | 'warning' | 'error';
  entityId?: string;
  entityType?: string;
}

const BACKEND_URL = config.BACKEND_URL || 'http://localhost:4000';
const WEBHOOK_ENDPOINT = `${BACKEND_URL}/api/webhooks/ai-notification`;

/**
 * Send notification to backend webhook
 * @param payload Notification data
 * @returns Promise<boolean> - true if successful, false otherwise
 */
export async function sendNotificationToBackend(payload: NotificationPayload): Promise<boolean> {
  try {
    const response = await fetch(WEBHOOK_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }));
      console.error('[Sistema] ❌ Falló el envío de notificación:', error);
      return false;
    }

    const result = await response.json();
    // console.log('[Sistema] Notificación enviada con éxito:', result);
    return true;
  } catch (error) {
    console.error('[Sistema] ❌ Error enviando notificación:', error);
    return false;
  }
}

/**
 * Send ANOMALY_PERTURBATION notification
 */
export async function notifyAnomaly(
  userId: string,
  transactionId: string,
  amount: number,
  category: string,
  reason: string,
  severity: 'low' | 'medium' | 'high'
): Promise<boolean> {
  const severityMap = {
    low: 'info' as const,
    medium: 'warning' as const,
    high: 'error' as const,
  };

  return sendNotificationToBackend({
    userId,
    type: 'ANOMALY_PERTURBATION',
    message: reason,
    severity: severityMap[severity],
    entityId: transactionId,
    entityType: 'transaction',
  });
}

/**
 * Send RECURRING_SUBSCRIPTION_DETECTED notification
 */
export async function notifyRecurringSubscription(
  userId: string,
  merchant: string,
  avgAmount: number,
  frequency: number
): Promise<boolean> {
  const frequencyText = frequency >= 10 ? 'muy frecuentes' : frequency >= 5 ? 'frecuentes' : 'recurrentes';
  const message = `Detectamos pagos ${frequencyText} de ~${formatCurrency(avgAmount)} a "${merchant}". ¿Es una suscripción?`;

  return sendNotificationToBackend({
    userId,
    type: 'RECURRING_SUBSCRIPTION_DETECTED',
    message,
    severity: 'info',
  });
}

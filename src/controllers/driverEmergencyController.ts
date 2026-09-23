import type { Request, Response } from 'express';
import { Order } from '../models/Order';
import { EmergencyIncident, type EmergencyIncidentType } from '../models/EmergencyIncident';
import { LocationShare } from '../models/LocationShare';
import { EarningsLedger } from '../models/EarningsLedger';
import { getDriverBalance } from '../lib/driverEarnings';
import { notifyDriver } from '../lib/driverNotify';
import { toSafeJson } from '../lib/sanitize';
import { HttpError } from '../lib/httpError';

interface IncidentInput {
  orderId?: string;
  type: EmergencyIncidentType;
  description?: string;
  medicalNeeded?: boolean;
  evidenceUrls?: string[];
  lat?: number;
  lng?: number;
  address?: string;
}

async function createIncidentAndReassign(driverId: string, input: IncidentInput) {
  let order = null;
  if (input.orderId) {
    order = await Order.findOne({ _id: input.orderId, driverId });
  }

  const incident = await EmergencyIncident.create({
    driverId,
    orderId: order?._id as never,
    type: input.type,
    description: input.description,
    medicalNeeded: input.medicalNeeded ?? false,
    evidenceUrls: input.evidenceUrls ?? [],
    location: input.lat != null && input.lng != null ? { lat: input.lat, lng: input.lng, address: input.address } : undefined,
    occurredAt: new Date(),
  });

  let earningsProtectedAmount = 0;
  if (order && order.status !== 'delivered' && order.status !== 'cancelled') {
    earningsProtectedAmount = order.pricing.deliveryFee ?? 0;

    order.driverId = undefined;
    order.status = 'ready_for_pickup';
    order.statusHistory.push({ status: 'ready_for_pickup', at: new Date(), note: `Reassigned after driver emergency (${input.type})` });
    await order.save();

    if (earningsProtectedAmount > 0) {
      const balanceAfter = (await getDriverBalance(driverId)) + earningsProtectedAmount;
      await EarningsLedger.create({
        driverId: driverId as never,
        orderId: order._id as never,
        type: 'earnings_protection',
        amount: earningsProtectedAmount,
        balanceAfter,
        status: 'pending',
        reason: `Earnings protected after emergency (${input.type}) on order #${order.orderNumber}`,
      });
    }

    incident.orderReassigned = true;
    incident.earningsProtectedAmount = earningsProtectedAmount;
    await incident.save();
  }

  await notifyDriver(driverId, 'Account', 'Emergency reported', 'Our safety team has been notified and is reviewing your report.', {
    relatedEntityType: 'EmergencyIncident',
    relatedEntityId: incident._id,
  });

  return incident;
}

export async function activate(req: Request, res: Response) {
  const { orderId, type, description, medicalNeeded, lat, lng, address } = req.body as IncidentInput;
  const incident = await createIncidentAndReassign(req.user!.id, { orderId, type, description, medicalNeeded, lat, lng, address });
  res.status(201).json(toSafeJson(incident));
}

export async function reportIncident(req: Request, res: Response) {
  const { orderId, type, description, medicalNeeded, evidenceUrls, lat, lng, address } = req.body as IncidentInput;
  const incident = await createIncidentAndReassign(req.user!.id, {
    orderId,
    type,
    description,
    medicalNeeded,
    evidenceUrls,
    lat,
    lng,
    address,
  });
  res.status(201).json(toSafeJson(incident));
}

export async function getIncidentById(req: Request, res: Response) {
  const incident = await EmergencyIncident.findOne({ _id: req.params.id, driverId: req.user!.id });
  if (!incident) throw new HttpError(404, 'Incident not found');
  res.json(toSafeJson(incident));
}

export async function shareLocation(req: Request, res: Response) {
  const { lat, lng, accuracy, orderId, incidentId, sharedWithEmergency, sharedWithSupport, sharedWithContact } = req.body as {
    lat: number;
    lng: number;
    accuracy?: number;
    orderId?: string;
    incidentId?: string;
    sharedWithEmergency?: boolean;
    sharedWithSupport?: boolean;
    sharedWithContact?: boolean;
  };

  let share = await LocationShare.findOne({ driverId: req.user!.id, endedAt: null });
  if (share) {
    share.lat = lat;
    share.lng = lng;
    share.accuracy = accuracy;
    if (sharedWithEmergency != null) share.sharedWithEmergency = sharedWithEmergency;
    if (sharedWithSupport != null) share.sharedWithSupport = sharedWithSupport;
    if (sharedWithContact != null) share.sharedWithContact = sharedWithContact;
    await share.save();
  } else {
    share = await LocationShare.create({
      driverId: req.user!.id,
      orderId,
      incidentId,
      lat,
      lng,
      accuracy,
      sharedWithEmergency: sharedWithEmergency ?? false,
      sharedWithSupport: sharedWithSupport ?? false,
      sharedWithContact: sharedWithContact ?? false,
      startedAt: new Date(),
    });
  }

  res.status(201).json(toSafeJson(share));
}

export async function stopSharing(req: Request, res: Response) {
  const share = await LocationShare.findOneAndUpdate(
    { driverId: req.user!.id, endedAt: null },
    { endedAt: new Date() },
    { new: true },
  );
  if (!share) throw new HttpError(404, 'No active location share found');
  res.json(toSafeJson(share));
}

export async function contactSupport(req: Request, res: Response) {
  const { message, orderId } = req.body as { message: string; orderId?: string };

  await notifyDriver(req.user!.id, 'Account', 'Support request received', message, {
    relatedEntityType: orderId ? 'Order' : undefined,
    relatedEntityId: orderId,
  });

  res.status(201).json({ ok: true });
}

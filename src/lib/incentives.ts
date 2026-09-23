import type { HydratedDocument } from 'mongoose';
import type { OrderDoc } from '../models/Order';
import { Incentive } from '../models/Incentive';
import { DriverIncentiveProgress } from '../models/DriverIncentiveProgress';
import { EarningsLedger } from '../models/EarningsLedger';
import { notifyDriver } from './driverNotify';
import { getDriverBalance } from './driverEarnings';

/** Advances every active incentive's progress for this driver by one completed
 * delivery, crediting a bonus + notifying the driver the moment a target is hit.
 * Returns the total incentive bonus awarded during this call, so callers can fold
 * it into the order's own earnings snapshot. */
export async function updateIncentiveProgress(driverId: unknown, order: HydratedDocument<OrderDoc>): Promise<number> {
  const now = new Date();
  const activeIncentives = await Incentive.find({ status: 'active', startAt: { $lte: now }, expiresAt: { $gte: now } });

  let totalBonus = 0;

  for (const incentive of activeIncentives) {
    const progress = (await DriverIncentiveProgress.findOneAndUpdate(
      { driverId: driverId as never, incentiveId: incentive._id as never },
      { $setOnInsert: { currentProgress: 0, status: 'in_progress' } },
      { upsert: true, new: true },
    ))!;

    if (progress.status === 'completed' || progress.status === 'expired') continue;

    progress.currentProgress += 1;
    if (progress.currentProgress >= incentive.targetDeliveries) {
      progress.status = 'completed';
      progress.completedAt = now;
      progress.payoutAmount = incentive.rewardAmount;
      await progress.save();

      const balanceAfter = (await getDriverBalance(driverId)) + incentive.rewardAmount;
      await EarningsLedger.create({
        driverId: driverId as never,
        orderId: order._id as never,
        type: 'incentive_bonus',
        amount: incentive.rewardAmount,
        balanceAfter,
        status: 'pending',
        reason: `Incentive completed: ${incentive.title}`,
      });

      await notifyDriver(driverId, 'Earnings', 'Incentive completed!', `You earned ₹${incentive.rewardAmount} for "${incentive.title}".`, {
        relatedEntityType: 'Incentive',
        relatedEntityId: incentive._id,
      });

      totalBonus += incentive.rewardAmount;
    } else {
      await progress.save();
    }
  }

  return totalBonus;
}

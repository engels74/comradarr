import { eq } from 'drizzle-orm';
import { decrypt, encrypt } from '$lib/server/crypto';
import { db } from '$lib/server/db';
import { connectors, notificationChannels, prowlarrInstances } from '$lib/server/db/schema';
import { createLogger } from '$lib/server/logger';

const logger = createLogger('crypto-migration');

interface MigrationResult {
	connectors: { total: number; migrated: number; skipped: number; failed: number };
	notificationChannels: { total: number; migrated: number; skipped: number; failed: number };
	prowlarrInstances: { total: number; migrated: number; skipped: number; failed: number };
}

function needsMigration(encrypted: string): boolean {
	const ivHex = encrypted.split(':')[0];
	return ivHex !== undefined && ivHex.length === 32;
}

async function reEncrypt(encrypted: string): Promise<string> {
	const plaintext = await decrypt(encrypted);
	return encrypt(plaintext);
}

export async function migrateEncryptedValues(): Promise<MigrationResult> {
	const result: MigrationResult = {
		connectors: { total: 0, migrated: 0, skipped: 0, failed: 0 },
		notificationChannels: { total: 0, migrated: 0, skipped: 0, failed: 0 },
		prowlarrInstances: { total: 0, migrated: 0, skipped: 0, failed: 0 }
	};

	const allConnectors = await db.select().from(connectors);
	result.connectors.total = allConnectors.length;
	logger.info('Migrating connector API keys', { total: allConnectors.length });

	for (const connector of allConnectors) {
		try {
			if (!needsMigration(connector.apiKeyEncrypted)) {
				result.connectors.skipped++;
				continue;
			}
			const newEncrypted = await reEncrypt(connector.apiKeyEncrypted);
			await db
				.update(connectors)
				.set({ apiKeyEncrypted: newEncrypted, updatedAt: new Date() })
				.where(eq(connectors.id, connector.id));
			result.connectors.migrated++;
		} catch (error) {
			result.connectors.failed++;
			logger.error('Failed to migrate connector', {
				connectorId: connector.id,
				error: error instanceof Error ? error.message : 'Unknown error'
			});
		}
	}

	const allChannels = await db.select().from(notificationChannels);
	result.notificationChannels.total = allChannels.length;
	logger.info('Migrating notification channel configs', { total: allChannels.length });

	for (const channel of allChannels) {
		try {
			if (!channel.configEncrypted || !needsMigration(channel.configEncrypted)) {
				result.notificationChannels.skipped++;
				continue;
			}
			const newEncrypted = await reEncrypt(channel.configEncrypted);
			await db
				.update(notificationChannels)
				.set({ configEncrypted: newEncrypted, updatedAt: new Date() })
				.where(eq(notificationChannels.id, channel.id));
			result.notificationChannels.migrated++;
		} catch (error) {
			result.notificationChannels.failed++;
			logger.error('Failed to migrate notification channel', {
				channelId: channel.id,
				error: error instanceof Error ? error.message : 'Unknown error'
			});
		}
	}

	const allProwlarr = await db.select().from(prowlarrInstances);
	result.prowlarrInstances.total = allProwlarr.length;
	logger.info('Migrating prowlarr instance API keys', { total: allProwlarr.length });

	for (const instance of allProwlarr) {
		try {
			if (!needsMigration(instance.apiKeyEncrypted)) {
				result.prowlarrInstances.skipped++;
				continue;
			}
			const newEncrypted = await reEncrypt(instance.apiKeyEncrypted);
			await db
				.update(prowlarrInstances)
				.set({ apiKeyEncrypted: newEncrypted, updatedAt: new Date() })
				.where(eq(prowlarrInstances.id, instance.id));
			result.prowlarrInstances.migrated++;
		} catch (error) {
			result.prowlarrInstances.failed++;
			logger.error('Failed to migrate prowlarr instance', {
				instanceId: instance.id,
				error: error instanceof Error ? error.message : 'Unknown error'
			});
		}
	}

	logger.info('Migration complete', result as unknown as Record<string, unknown>);
	return result;
}

import { RadarrClient, SonarrClient, WhisparrClient } from '$lib/server/connectors';
import type { CommandStatus as ArrCommandStatus } from '$lib/server/connectors/common/types';
import { getDecryptedApiKey, getEnabledConnectors } from '$lib/server/db/queries/connectors';
import {
	cleanupTimedOutCommands,
	deleteCompletedCommands,
	getUncompletedCommands,
	updateCommandStatus
} from '$lib/server/db/queries/pending-commands';
import type { Connector, PendingCommand } from '$lib/server/db/schema';
import { createLogger } from '$lib/server/logger';

const logger = createLogger('command-monitor');

export interface CommandCheckResult {
	success: boolean;
	connectorsChecked: number;
	commandsChecked: number;
	commandsCompleted: number;
	commandsFailed: number;
	commandsTimedOut: number;
	error?: string;
}

function createClient(
	connector: Connector,
	apiKey: string
): SonarrClient | RadarrClient | WhisparrClient {
	const config = { baseUrl: connector.url, apiKey };

	switch (connector.type) {
		case 'sonarr':
			return new SonarrClient(config);
		case 'radarr':
			return new RadarrClient(config);
		case 'whisparr':
			return new WhisparrClient(config);
		default:
			throw new Error(`Unsupported connector type: ${connector.type}`);
	}
}

function mapArrStatusToDbStatus(
	arrStatus: ArrCommandStatus
): 'queued' | 'started' | 'completed' | 'failed' {
	return arrStatus;
}

async function checkCommandsForConnector(
	connector: Connector,
	pendingCommands: PendingCommand[]
): Promise<{ completed: number; failed: number; checked: number }> {
	const result = { completed: 0, failed: 0, checked: 0 };

	if (pendingCommands.length === 0) {
		return result;
	}

	try {
		const apiKey = await getDecryptedApiKey(connector);
		const client = createClient(connector, apiKey);

		for (const pendingCommand of pendingCommands) {
			result.checked++;

			try {
				const commandResponse = await client.getCommandStatus(pendingCommand.commandId);
				const newStatus = mapArrStatusToDbStatus(commandResponse.status);

				if (newStatus === 'completed') {
					result.completed++;
					await updateCommandStatus(pendingCommand.id, 'completed');
					logger.debug('Command completed', {
						commandId: pendingCommand.commandId,
						connectorId: connector.id,
						contentType: pendingCommand.contentType,
						contentId: pendingCommand.contentId
					});
				} else if (newStatus === 'failed') {
					result.failed++;
					await updateCommandStatus(pendingCommand.id, 'failed', false);
					logger.debug('Command failed', {
						commandId: pendingCommand.commandId,
						connectorId: connector.id,
						contentType: pendingCommand.contentType,
						contentId: pendingCommand.contentId
					});
				} else if (newStatus !== pendingCommand.commandStatus) {
					await updateCommandStatus(pendingCommand.id, newStatus);
				}
			} catch (error) {
				logger.warn('Failed to check command status', {
					commandId: pendingCommand.commandId,
					connectorId: connector.id,
					error: error instanceof Error ? error.message : String(error)
				});
			}
		}
	} catch (error) {
		logger.error('Failed to check commands for connector', {
			connectorId: connector.id,
			connectorName: connector.name,
			error: error instanceof Error ? error.message : String(error)
		});
	}

	return result;
}

export async function checkPendingCommands(): Promise<CommandCheckResult> {
	const result: CommandCheckResult = {
		success: true,
		connectorsChecked: 0,
		commandsChecked: 0,
		commandsCompleted: 0,
		commandsFailed: 0,
		commandsTimedOut: 0
	};

	try {
		const connectors = await getEnabledConnectors();

		for (const connector of connectors) {
			const pendingForConnector = await getUncompletedCommands(connector.id);

			if (pendingForConnector.length === 0) {
				continue;
			}

			result.connectorsChecked++;
			const checkResult = await checkCommandsForConnector(connector, pendingForConnector);

			result.commandsChecked += checkResult.checked;
			result.commandsCompleted += checkResult.completed;
			result.commandsFailed += checkResult.failed;
		}

		const timedOut = await cleanupTimedOutCommands(24);
		result.commandsTimedOut = timedOut;

		if (result.commandsChecked > 0 || result.commandsTimedOut > 0) {
			logger.info('Command check completed', {
				connectorsChecked: result.connectorsChecked,
				commandsChecked: result.commandsChecked,
				commandsCompleted: result.commandsCompleted,
				commandsFailed: result.commandsFailed,
				commandsTimedOut: result.commandsTimedOut
			});
		}
	} catch (error) {
		result.success = false;
		result.error = error instanceof Error ? error.message : String(error);
		logger.error('Failed to check pending commands', { error: result.error });
	}

	return result;
}

export async function cleanupOldCompletedCommands(retentionDays: number = 7): Promise<number> {
	try {
		const deleted = await deleteCompletedCommands(retentionDays);
		if (deleted > 0) {
			logger.info('Cleaned up old completed commands', { deleted, retentionDays });
		}
		return deleted;
	} catch (error) {
		logger.error('Failed to cleanup old completed commands', {
			error: error instanceof Error ? error.message : String(error)
		});
		return 0;
	}
}

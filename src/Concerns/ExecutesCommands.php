<?php

declare(strict_types=1);

namespace Native\Agent\Concerns;

use Native\Agent\Commands\CommandRegistry;
use Native\Agent\MessageTypes;
use Throwable;
use WebSocket\ConnectionException;
use WebSocket\TimeoutException;

trait ExecutesCommands
{
    protected ?CommandRegistry $commandRegistry = null;

    public function processIncomingCommands(): void
    {
        $client = $this->client;

        if (! $client) {
            return;
        }

        try {
            $client->setTimeout(0.1);

            $message = $client->receive();

            if ($message === null) {
                return;
            }

            $data = json_decode($message, true);

            if (json_last_error() !== JSON_ERROR_NONE) {
                return;
            }

            if (($data['type'] ?? '') === MessageTypes::COMMAND) {
                $this->handleCommandMessage($data);
            }
        } catch (TimeoutException $e) {
        } catch (ConnectionException $e) {
            $this->client = null;
            $this->connectionFailed = true;
        } catch (Throwable $e) {
            // Ignore command processing errors
        }
    }

    protected function handleCommandMessage(array $data): void
    {
        $command = $data['command'] ?? 'unknown';
        $commandId = $data['command_id'] ?? null;
        $params = $data['params'] ?? [];

        // Don't log here - log commands like logs:poll would create a feedback loop.

        $this->sendCommandResponse(
            $commandId,
            $this->executeCommand($command, $params)
        );
    }

    /**
     * Send a command response back to the desktop.
     */
    protected function sendCommandResponse(?string $commandId, array $result): void
    {
        $success = ! isset($result['error']);

        $this->sendImmediate([
            'type' => MessageTypes::COMMAND_RESPONSE,
            'command_id' => $commandId,
            'success' => $success,
            'data' => $result,
        ]);
    }

    /**
     * Execute a command from the desktop app.
     */
    public function executeCommand(string $command, array $params = []): array
    {
        return $this->getCommandRegistry()->execute($command, $params);
    }

    /**
     * Get the command registry (lazy instantiation).
     */
    protected function getCommandRegistry(): CommandRegistry
    {
        if ($this->commandRegistry === null) {
            $this->commandRegistry = app(CommandRegistry::class);
        }

        return $this->commandRegistry;
    }
}

<?php

declare(strict_types=1);

namespace Native\Agent\Concerns;

use Exception;
use Illuminate\Support\Facades\Log;
use Native\Agent\MessageTypes;
use WebSocket\Client;
use WebSocket\ConnectionException;

trait ManagesConnection
{
    protected ?Client $client = null;

    protected bool $connectionFailed = false;

    protected array $messageQueue = [];

    protected bool $queueingEnabled = true;

    /**
     * @param  bool  $immediate  Force immediate send, bypassing the queue
     */
    public function send(string $type, array $payload = [], bool $immediate = false): bool
    {
        $config = $this->discover();

        if (! $config) {
            Log::debug('[Agent] Send failed: no config (pairing file missing?)', [
                'pairing_path' => $this->getPairingPath(),
            ]);

            return false;
        }

        $message = [
            'type' => $type,
            'project_id' => $config['project_id'],
            'app_id' => $this->getAppId(),
            'payload' => $payload,
        ];

        if ($this->requestId) {
            $message['request_id'] = $this->requestId;
        }

        if ($this->queueingEnabled && ! $immediate) {
            $this->messageQueue[] = $message;

            return true;
        }

        return $this->sendImmediate($message);
    }

    protected function sendImmediate(array $message): bool
    {
        try {
            $client = $this->getClient();

            if (! $client) {
                Log::debug('[Agent] Send failed: could not get WebSocket client', [
                    'connection_failed' => $this->connectionFailed,
                ]);

                return false;
            }

            $client->text(json_encode($message));

            return true;
        } catch (ConnectionException $e) {
            Log::debug('[Agent] Send failed: connection exception', ['error' => $e->getMessage()]);
            $this->client = null;
            $this->connectionFailed = true;

            return false;
        } catch (Exception $e) {
            Log::debug('[Agent] Send failed: exception', ['error' => $e->getMessage()]);
            $this->client = null;
            $this->connectionFailed = true;

            return false;
        }
    }

    public function flushQueue(): int
    {
        if (empty($this->messageQueue)) {
            return 0;
        }

        $count = count($this->messageQueue);
        Log::debug('[Agent] flushQueue: Flushing '.$count.' messages');
        $sent = 0;

        foreach ($this->messageQueue as $message) {
            if ($this->sendImmediate($message)) {
                $sent++;
            }
        }

        Log::debug('[Agent] flushQueue: Sent '.$sent.'/'.$count.' messages');
        $this->messageQueue = [];

        return $sent;
    }

    public function setQueueingEnabled(bool $enabled): void
    {
        $this->queueingEnabled = $enabled;

        // If disabling, flush any pending messages
        if (! $enabled) {
            $this->flushQueue();
        }
    }

    public function sendHandshake(): bool
    {
        $config = $this->discover();

        if (! $config) {
            return false;
        }

        try {
            $client = $this->getClient();

            if (! $client) {
                return false;
            }

            $message = json_encode([
                'type' => MessageTypes::HANDSHAKE,
                'project_id' => $config['project_id'],
                'app_id' => $this->getAppId(),
                'origin' => $this->getCallbackOrigin(),
                'app_info' => [
                    'name' => config('app.name'),
                    'laravel_version' => app()->version(),
                    'php_version' => PHP_VERSION,
                ],
            ]);

            $client->text($message);

            return true;
        } catch (ConnectionException $e) {
            $this->client = null;
            $this->connectionFailed = true;

            return false;
        } catch (Exception $e) {
            $this->client = null;
            $this->connectionFailed = true;

            return false;
        }
    }

    protected function getClient(): ?Client
    {
        if ($this->connectionFailed) {
            Log::debug('[Agent] getClient: Connection already failed, skipping');

            return null;
        }

        if ($this->client !== null) {
            return $this->client;
        }

        $config = $this->discover();

        if (! $config) {
            Log::debug('[Agent] getClient: No config (pairing file issue?)');

            return null;
        }

        $wsUrl = $config['ws_url'];
        Log::debug('[Agent] getClient: Connecting to '.$wsUrl);

        try {
            $timeout = (int) config('agent.websocket_timeout', 1);

            $this->client = new Client($wsUrl, [
                'timeout' => $timeout,
            ]);

            Log::debug('[Agent] WebSocket connected successfully');

            return $this->client;
        } catch (ConnectionException $e) {
            Log::debug('[Agent] WebSocket connection failed', [
                'error' => $e->getMessage(),
                'ws_url' => $wsUrl,
            ]);
            $this->connectionFailed = true;

            return null;
        } catch (Exception $e) {
            Log::debug('[Agent] WebSocket connection failed', [
                'error' => $e->getMessage(),
            ]);
            $this->connectionFailed = true;

            return null;
        }
    }

    public function disconnect(): void
    {
        if ($this->client) {
            try {
                $this->client->close();
            } catch (Exception $e) {
                // Ignore close errors
            }
            $this->client = null;
        }
    }
}

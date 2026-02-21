<?php

declare(strict_types=1);

namespace Native\Agent\Concerns;

use Native\Agent\MessageTypes;

trait SendsEvents
{
    /**
     * Send a request start event.
     */
    public function sendRequestStart(string $method, string $path, bool $isLivewire = false): bool
    {
        return $this->send(MessageTypes::REQUEST, [
            'action' => MessageTypes::ACTION_START,
            'method' => $method,
            'path' => $path,
            'is_livewire' => $isLivewire,
            'timestamp' => now()->toIso8601String(),
        ]);
    }

    /**
     * Send a request end event.
     */
    public function sendRequestEnd(int $status): bool
    {
        return $this->send(MessageTypes::REQUEST, [
            'action' => MessageTypes::ACTION_END,
            'status' => $status,
            'duration' => $this->getRequestDuration(),
            'query_count' => $this->getQueryCount(),
            'timestamp' => now()->toIso8601String(),
        ]);
    }

    /**
     * Send a database query event.
     */
    public function sendQuery(string $sql, array $bindings, float $time, string $connection, ?string $file = null, ?int $line = null): bool
    {
        $this->incrementQueryCount();

        return $this->send(MessageTypes::QUERY, [
            'sql' => $sql,
            'bindings' => $bindings,
            'time' => round($time, 2),
            'connection' => $connection,
            'file' => $file,
            'line' => $line,
            'timestamp' => now()->toIso8601String(),
        ]);
    }

    /**
     * Send a Livewire event.
     */
    public function sendLivewire(string $action, string $component, string $componentId, array $extra = []): bool
    {
        return $this->send(MessageTypes::LIVEWIRE, array_merge([
            'action' => $action,
            'component' => $component,
            'component_id' => $componentId,
            'timestamp' => now()->toIso8601String(),
        ], $extra));
    }

    /**
     * Send a method call event.
     */
    public function sendMethodCall(array $data): bool
    {
        return $this->send(MessageTypes::METHOD_CALL, array_merge([
            'timestamp' => now()->toIso8601String(),
        ], $data));
    }

    /**
     * Send a property change event.
     */
    public function sendPropertyChange(array $data): bool
    {
        return $this->send(MessageTypes::PROPERTY_CHANGE, array_merge([
            'timestamp' => now()->toIso8601String(),
        ], $data));
    }

    /**
     * Broadcast a message.
     */
    public function broadcast(string $type, array $payload = []): bool
    {
        return $this->send($type, $payload);
    }
}

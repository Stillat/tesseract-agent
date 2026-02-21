<?php

namespace Native\Agent\Collectors;

use Native\Agent\AgentConnector;
use Throwable;

abstract class BaseCollector
{
    protected AgentConnector $connector;

    public function __construct(AgentConnector $connector)
    {
        $this->connector = $connector;
    }

    /**
     * Get the unique identifier for this collector.
     */
    abstract public function getName(): string;

    /**
     * Get the category for grouping in the UI.
     * Common categories: 'device', 'performance', 'app', 'custom'
     */
    abstract public function getCategory(): string;

    /**
     * Collect and return data.
     * The returned array will be sent to the Agent dashboard.
     */
    abstract public function collect(): array;

    /**
     * Override to implement custom activation logic.
     * Return false to prevent this collector from being activated.
     *
     * Use this for feature detection, e.g., checking if a
     * required package or API is available.
     */
    public function shouldActivate(): bool
    {
        return true;
    }

    /**
     * Override to specify which environments this collector runs in.
     * Return ['*'] (default) to run in all environments.
     * Return specific environments like ['local', 'staging'] to restrict.
     */
    public function environments(): array
    {
        return ['*'];
    }

    /**
     * Override to set automatic collection interval in seconds.
     * Return 0 (default) for on-demand only (no automatic collection).
     * Return > 0 for periodic collection (e.g., 30 for every 30 seconds).
     */
    public function interval(): int
    {
        return 0;
    }

    /**
     * Get a human-readable label for the UI.
     * Defaults to the collector name with some formatting.
     */
    public function getLabel(): string
    {
        return str_replace('_', ' ', ucwords($this->getName(), '_'));
    }

    /**
     * Called by CollectorManager to run the collector and broadcast results.
     */
    final public function run(): void
    {
        try {
            $data = $this->collect();

            $this->connector->broadcast('collector_data', [
                'collector' => $this->getName(),
                'category' => $this->getCategory(),
                'label' => $this->getLabel(),
                'data' => $data,
                'timestamp' => now()->toIso8601String(),
            ]);
        } catch (Throwable $e) {
            $this->connector->broadcast('collector_error', [
                'collector' => $this->getName(),
                'error' => $e->getMessage(),
                'timestamp' => now()->toIso8601String(),
            ]);
        }
    }

    /**
     * Get the manifest entry for this collector (for UI registration).
     */
    public function getManifest(): array
    {
        return [
            'name' => $this->getName(),
            'category' => $this->getCategory(),
            'label' => $this->getLabel(),
            'interval' => $this->interval(),
            'environments' => $this->environments(),
        ];
    }
}

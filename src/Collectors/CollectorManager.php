<?php

namespace Native\Agent\Collectors;

use Illuminate\Support\Facades\File;
use Native\Agent\AgentConnector;
use ReflectionClass;
use Throwable;

/**
 * Manages collector discovery, activation, and scheduling.
 */
class CollectorManager
{
    protected AgentConnector $connector;

    protected string $environment;

    protected array $collectors = [];

    protected array $timers = [];

    protected bool $started = false;

    public function __construct(AgentConnector $connector, string $environment)
    {
        $this->connector = $connector;
        $this->environment = $environment;
    }

    /**
     * Auto-discover and register collectors from the Collectors directory.
     */
    public function discover(): void
    {
        $collectorsPath = __DIR__;
        $files = glob($collectorsPath.'/*Collector.php');

        foreach ($files as $file) {
            $class = $this->resolveClass($file);

            if (! $class || $class === BaseCollector::class) {
                continue;
            }

            if (! class_exists($class)) {
                continue;
            }

            $reflection = new ReflectionClass($class);
            if ($reflection->isAbstract()) {
                continue;
            }

            try {
                $collector = new $class($this->connector);

                if ($this->shouldActivate($collector)) {
                    $this->register($collector);
                }
            } catch (Throwable $e) {
                logger()->debug("Collector {$class} failed to instantiate: ".$e->getMessage());
            }
        }
    }

    /**
     * Resolve the fully qualified class name from a file path.
     */
    protected function resolveClass(string $file): ?string
    {
        $filename = basename($file, '.php');

        return "Native\\Agent\\Collectors\\{$filename}";
    }

    /**
     * Check if a collector should be activated based on environment and custom logic.
     */
    protected function shouldActivate(BaseCollector $collector): bool
    {
        $envs = $collector->environments();
        if ($envs !== ['*'] && ! in_array($this->environment, $envs)) {
            return false;
        }

        return $collector->shouldActivate();
    }

    /**
     * Register a collector instance.
     */
    public function register(BaseCollector $collector): void
    {
        $this->collectors[$collector->getName()] = $collector;
    }

    /**
     * Get all registered collectors.
     */
    public function getCollectors(): array
    {
        return $this->collectors;
    }

    /**
     * Get a specific collector by name.
     */
    public function getCollector(string $name): ?BaseCollector
    {
        return $this->collectors[$name] ?? null;
    }

    /**
     * Start scheduled collectors.
     */
    public function startScheduled(): void
    {
        if ($this->started) {
            return;
        }

        $this->started = true;

        foreach ($this->collectors as $name => $collector) {
            $interval = $collector->interval();

            if ($interval > 0) {
                $collector->run();
            }
        }
    }

    /**
     * Run all collectors and return combined results.
     */
    public function collectAll(): array
    {
        $results = [];

        foreach ($this->collectors as $collector) {
            try {
                $results[$collector->getName()] = [
                    'category' => $collector->getCategory(),
                    'label' => $collector->getLabel(),
                    'data' => $collector->collect(),
                    'timestamp' => now()->toIso8601String(),
                ];
            } catch (Throwable $e) {
                $results[$collector->getName()] = [
                    'category' => $collector->getCategory(),
                    'label' => $collector->getLabel(),
                    'error' => $e->getMessage(),
                    'timestamp' => now()->toIso8601String(),
                ];
            }
        }

        return $results;
    }

    /**
     * Run a specific collector by name.
     */
    public function runCollector(string $name): ?array
    {
        $collector = $this->getCollector($name);

        if (! $collector) {
            return null;
        }

        try {
            return [
                'success' => true,
                'collector' => $name,
                'category' => $collector->getCategory(),
                'label' => $collector->getLabel(),
                'data' => $collector->collect(),
                'timestamp' => now()->toIso8601String(),
            ];
        } catch (Throwable $e) {
            return [
                'success' => false,
                'collector' => $name,
                'error' => $e->getMessage(),
                'timestamp' => now()->toIso8601String(),
            ];
        }
    }

    /**
     * Get the manifest of all registered collectors.
     */
    public function getManifest(): array
    {
        $manifest = [];

        foreach ($this->collectors as $collector) {
            $manifest[] = $collector->getManifest();
        }

        return $manifest;
    }

    /**
     * Send the collector manifest to the Agent dashboard.
     */
    public function sendManifest(): void
    {
        $this->connector->broadcast('collector_manifest', [
            'collectors' => $this->getManifest(),
            'environment' => $this->environment,
            'timestamp' => now()->toIso8601String(),
        ]);
    }

    /**
     * Stop all scheduled collectors.
     */
    public function stop(): void
    {
        $this->started = false;
        $this->timers = [];
    }
}

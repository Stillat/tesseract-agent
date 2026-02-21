<?php

namespace Native\src\Actions;

use Native\src\AgentConnector;
use ReflectionClass;
use Throwable;

class ActionManager
{
    protected AgentConnector $connector;

    protected string $environment;

    protected array $actions = [];

    public function __construct(AgentConnector $connector, string $environment)
    {
        $this->connector = $connector;
        $this->environment = $environment;
    }

    /**
     * Auto-discover and register actions from the Actions directory.
     */
    public function discover(): void
    {
        $actionsPath = __DIR__;
        $files = glob($actionsPath.'/*Action.php');

        foreach ($files as $file) {
            $class = $this->resolveClass($file);

            if (! $class || $class === BaseAction::class) {
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
                $action = new $class($this->connector);

                if ($this->shouldActivate($action)) {
                    $this->register($action);
                }
            } catch (Throwable $e) {
                logger()->debug("Action {$class} failed to instantiate: ".$e->getMessage());
            }
        }
    }

    /**
     * Resolve the fully qualified class name from a file path.
     */
    protected function resolveClass(string $file): ?string
    {
        $filename = basename($file, '.php');

        return "Native\\Agent\\Actions\\{$filename}";
    }

    protected function shouldActivate(BaseAction $action): bool
    {
        $envs = $action->environments();
        if ($envs !== ['*'] && ! in_array($this->environment, $envs)) {
            return false;
        }

        return $action->shouldActivate();
    }

    public function register(BaseAction $action): void
    {
        $this->actions[$action->getName()] = $action;
    }

    public function getActions(): array
    {
        return $this->actions;
    }

    /**
     * Get a specific action by name.
     */
    public function getAction(string $name): ?BaseAction
    {
        return $this->actions[$name] ?? null;
    }

    /**
     * Execute an action by name.
     */
    public function executeAction(string $name, array $params = []): array
    {
        $action = $this->getAction($name);

        if (! $action) {
            return ['success' => false, 'error' => "Action '{$name}' not found"];
        }

        try {
            $result = $action->execute($params);

            // Broadcast the result
            $this->connector->broadcast('action_result', [
                'action' => $name,
                'label' => $action->getLabel(),
                'success' => $result['success'] ?? true,
                'message' => $result['message'] ?? null,
                'data' => $result['data'] ?? null,
                'timestamp' => now()->toIso8601String(),
            ]);

            return [
                'success' => $result['success'] ?? true,
                'action' => $name,
                'label' => $action->getLabel(),
                'message' => $result['message'] ?? null,
                'data' => $result['data'] ?? null,
                'timestamp' => now()->toIso8601String(),
            ];
        } catch (Throwable $e) {
            $error = [
                'success' => false,
                'action' => $name,
                'error' => $e->getMessage(),
                'timestamp' => now()->toIso8601String(),
            ];

            // Broadcast the error
            $this->connector->broadcast('action_result', $error);

            return $error;
        }
    }

    /**
     * Get the manifest of all registered actions.
     */
    public function getManifest(): array
    {
        $manifest = [];

        foreach ($this->actions as $action) {
            $manifest[] = $action->getManifest();
        }

        return $manifest;
    }

    public function sendManifest(): void
    {
        $this->connector->broadcast('action_manifest', [
            'actions' => $this->getManifest(),
            'environment' => $this->environment,
            'timestamp' => now()->toIso8601String(),
        ]);
    }
}

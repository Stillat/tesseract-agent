<?php

namespace Native\Agent\Actions;

use Native\Agent\AgentConnector;

abstract class BaseAction
{
    protected AgentConnector $connector;

    public function __construct(AgentConnector $connector)
    {
        $this->connector = $connector;
    }

    /**
     * Get the unique identifier for this action.
     */
    abstract public function getName(): string;

    /**
     * Get the display label for the UI button.
     */
    abstract public function getLabel(): string;

    /**
     * Get the Lucide icon name for the UI button.
     */
    abstract public function getIcon(): string;

    /**
     * Execute the action with optional parameters.
     *
     * Return an array with 'success' and optional 'message' keys.
     */
    abstract public function execute(array $params = []): array;

    /**
     * Override to implement custom activation logic.
     *
     * Return false to prevent this action from being available.
     */
    public function shouldActivate(): bool
    {
        return true;
    }

    /**
     * Override to specify which environments this action runs in.
     *
     * Return ['*'] (default) to run in all environments.
     */
    public function environments(): array
    {
        return ['*'];
    }

    /**
     * Override to require user confirmation before executing.
     */
    public function requiresConfirmation(): bool
    {
        return false;
    }

    /**
     * Override to define parameters for the action.
     * Return an array of parameter definitions for UI generation.
     *
     * Example:
     * return [
     *     ['name' => 'force', 'type' => 'boolean', 'label' => 'Force', 'default' => false],
     *     ['name' => 'queue', 'type' => 'string', 'label' => 'Queue name', 'default' => 'default'],
     * ];
     */
    public function parameters(): array
    {
        return [];
    }

    /**
     * Get the category for grouping in the UI.
     */
    public function getCategory(): string
    {
        return 'general';
    }

    /**
     * Get the manifest entry for this action.
     */
    public function getManifest(): array
    {
        return [
            'name' => $this->getName(),
            'label' => $this->getLabel(),
            'icon' => $this->getIcon(),
            'category' => $this->getCategory(),
            'requiresConfirmation' => $this->requiresConfirmation(),
            'parameters' => $this->parameters(),
            'environments' => $this->environments(),
        ];
    }
}

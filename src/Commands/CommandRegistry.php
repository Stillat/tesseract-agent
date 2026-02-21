<?php

declare(strict_types=1);

namespace Native\Agent\Commands;

use Illuminate\Contracts\Container\Container;
use InvalidArgumentException;

class CommandRegistry
{
    protected Container $container;

    /** @var array<string, class-string<BaseCommand>> Command name => class mapping */
    protected array $commands = [];

    /** @var array<string, BaseCommand> Resolved command instances (cached) */
    protected array $resolved = [];

    public function __construct(Container $container)
    {
        $this->container = $container;
    }

    public function register(string $commandClass): self
    {
        if (! is_subclass_of($commandClass, BaseCommand::class)) {
            throw new InvalidArgumentException(
                "{$commandClass} must extend ".BaseCommand::class
            );
        }

        $name = $commandClass::getCommandName();
        $this->commands[$name] = $commandClass;

        return $this;
    }

    public function registerMany(array $commandClasses): self
    {
        foreach ($commandClasses as $class) {
            $this->register($class);
        }

        return $this;
    }

    public function execute(string $commandName, array $params = []): array
    {
        if (! isset($this->commands[$commandName])) {
            return ['error' => "Unknown command: {$commandName}"];
        }

        $command = $this->resolve($commandName);

        return $command($params);
    }

    public function has(string $commandName): bool
    {
        return isset($this->commands[$commandName]);
    }

    public function getRegisteredCommands(): array
    {
        return array_keys($this->commands);
    }

    protected function resolve(string $commandName): BaseCommand
    {
        if (! isset($this->resolved[$commandName])) {
            $class = $this->commands[$commandName];
            $this->resolved[$commandName] = $this->container->make($class);
        }

        return $this->resolved[$commandName];
    }
}

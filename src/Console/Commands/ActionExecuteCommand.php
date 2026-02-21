<?php

declare(strict_types=1);

namespace Native\Agent\Console\Commands;

use Illuminate\Console\Command;
use Native\Agent\Actions\ActionManager;

class ActionExecuteCommand extends Command
{
    protected $signature = 'agent:action:execute
        {name : The action name to execute}
        {--params= : JSON-encoded parameters}';

    protected $description = 'Execute an Agent debug action';

    public function handle(ActionManager $actionManager): int
    {
        $name = $this->argument('name');
        $params = json_decode($this->option('params') ?? '{}', true) ?? [];

        if (json_last_error() !== JSON_ERROR_NONE) {
            $this->line(json_encode([
                'success' => false,
                'error' => 'Invalid JSON in --params option',
            ]));

            return self::FAILURE;
        }

        $result = $actionManager->executeAction($name, $params);
        $this->line(json_encode($result, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));

        return ($result['success'] ?? false) ? self::SUCCESS : self::FAILURE;
    }
}

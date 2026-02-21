<?php

namespace Native\Agent\Actions;

use Illuminate\Support\Facades\Artisan;

class RunMigrateAction extends BaseAction
{
    public function getName(): string
    {
        return 'run_migrate';
    }

    public function getLabel(): string
    {
        return 'Run Migrations';
    }

    public function getIcon(): string
    {
        return 'Database';
    }

    public function getCategory(): string
    {
        return 'database';
    }

    public function requiresConfirmation(): bool
    {
        return true;
    }

    public function environments(): array
    {
        return ['local', 'testing'];
    }

    public function parameters(): array
    {
        return [
            [
                'name' => 'fresh',
                'type' => 'boolean',
                'label' => 'Fresh (drop all tables first)',
                'default' => false,
            ],
            [
                'name' => 'seed',
                'type' => 'boolean',
                'label' => 'Run seeders after migration',
                'default' => false,
            ],
        ];
    }

    public function execute(array $params = []): array
    {
        $fresh = $params['fresh'] ?? false;
        $seed = $params['seed'] ?? false;

        $command = $fresh ? 'migrate:fresh' : 'migrate';
        $arguments = ['--force' => true];

        if ($seed) {
            $arguments['--seed'] = true;
        }

        Artisan::call($command, $arguments);
        $output = trim(Artisan::output());

        return [
            'success' => true,
            'message' => $fresh
                ? ($seed ? 'Database refreshed and seeded' : 'Database refreshed')
                : ($seed ? 'Migrations run and seeded' : 'Migrations run'),
            'data' => [
                'output' => $output,
            ],
        ];
    }
}

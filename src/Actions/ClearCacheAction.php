<?php

namespace Native\src\Actions;

use Illuminate\Support\Facades\Artisan;

class ClearCacheAction extends BaseAction
{
    public function getName(): string
    {
        return 'clear_cache';
    }

    public function getLabel(): string
    {
        return 'Clear Cache';
    }

    public function getIcon(): string
    {

        return 'Trash2';
    }

    public function getCategory(): string
    {
        return 'cache';
    }

    public function requiresConfirmation(): bool
    {
        return true;
    }

    public function parameters(): array
    {
        return [
            [
                'name' => 'include_views',
                'type' => 'boolean',
                'label' => 'Clear compiled views',
                'default' => true,
            ],
            [
                'name' => 'include_routes',
                'type' => 'boolean',
                'label' => 'Clear route cache',
                'default' => false,
            ],
            [
                'name' => 'include_config',
                'type' => 'boolean',
                'label' => 'Clear config cache',
                'default' => false,
            ],
        ];
    }

    public function execute(array $params = []): array
    {
        $cleared = [];

        // Always clear application cache
        Artisan::call('cache:clear');
        $cleared[] = 'application cache';

        // Optionally clear views
        if ($params['include_views'] ?? true) {
            Artisan::call('view:clear');
            $cleared[] = 'compiled views';
        }

        // Optionally clear routes
        if ($params['include_routes'] ?? false) {
            Artisan::call('route:clear');
            $cleared[] = 'route cache';
        }

        // Optionally clear config
        if ($params['include_config'] ?? false) {
            Artisan::call('config:clear');
            $cleared[] = 'config cache';
        }

        return [
            'success' => true,
            'message' => 'Cleared: '.implode(', ', $cleared),
        ];
    }
}

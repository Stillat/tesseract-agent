<?php

declare(strict_types=1);

namespace Native\src\Console\Commands;

use Illuminate\Console\Command;
use Native\src\Actions\ActionManager;

class ActionsCommand extends Command
{
    protected $signature = 'agent:actions
        {--json : Output as JSON for programmatic consumption}
        {--category= : Filter actions by category}';

    protected $description = 'List all registered Agent debug actions';

    public function handle(ActionManager $actionManager): int
    {
        $actions = $actionManager->getManifest();

        if ($category = $this->option('category')) {
            $actions = array_filter($actions, fn ($action) => ($action['category'] ?? 'general') === $category);
            $actions = array_values($actions);
        }

        if ($this->option('json')) {
            $categories = array_values(array_unique(array_map(
                fn ($action) => $action['category'] ?? 'general',
                $actions
            )));

            $output = [
                'success' => true,
                'actions' => $actions,
                'count' => count($actions),
                'categories' => $categories,
            ];

            $this->line(json_encode($output, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));

            return self::SUCCESS;
        }

        if (empty($actions)) {
            $this->info('No actions registered.');

            return self::SUCCESS;
        }

        $this->info('Registered Agent Actions:');
        $this->newLine();

        $tableData = [];
        foreach ($actions as $action) {
            $tableData[] = [
                $action['name'],
                $action['label'],
                $action['category'] ?? 'general',
                $action['icon'] ?? '-',
                $action['requiresConfirmation'] ? 'Yes' : 'No',
            ];
        }

        $this->table(
            ['Name', 'Label', 'Category', 'Icon', 'Confirm'],
            $tableData
        );

        $this->newLine();
        $this->info(sprintf('Total: %d action(s)', count($actions)));

        return self::SUCCESS;
    }
}

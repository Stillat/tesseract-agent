<?php

declare(strict_types=1);

namespace Native\Agent\Concerns;

use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Support\Facades\DB;
use Native\Agent\AgentConfig;
use Native\Agent\AgentConnector;

trait TracksQueries
{
    /**
     * Register the database query listener.
     */
    protected function registerQueryListener(AgentConnector $connector): void
    {
        DB::listen(function (QueryExecuted $query) use ($connector) {
            if (! $connector->isAvailable()) {
                return;
            }

            $caller = $this->getQueryCaller();

            $connector->sendQuery(
                sql: $query->sql,
                bindings: $this->formatBindings($query->bindings),
                time: $query->time,
                connection: $query->connectionName,
                file: $caller['file'] ?? null,
                line: $caller['line'] ?? null
            );
        });
    }

    protected function formatBindings(array $bindings): array
    {
        return array_map(function ($binding) {
            if ($binding instanceof \DateTimeInterface) {
                return $binding->format('Y-m-d H:i:s');
            }
            if (is_object($binding)) {
                return get_class($binding);
            }

            return $binding;
        }, $bindings);
    }

    /**
     * Get the file and line that triggered the query.
     */
    protected function getQueryCaller(): array
    {
        $trace = debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS, AgentConfig::STACK_TRACE_LIMIT);

        foreach ($trace as $frame) {
            $file = $frame['file'] ?? '';

            if (str_contains($file, DIRECTORY_SEPARATOR.'vendor'.DIRECTORY_SEPARATOR)) {
                continue;
            }
            if (str_contains($file, 'AgentServiceProvider')) {
                continue;
            }
            if (str_contains($file, 'AgentConnector')) {
                continue;
            }

            return [
                'file' => $this->shortenPath($file),
                'line' => $frame['line'] ?? null,
            ];
        }

        return [];
    }

    protected function shortenPath(string $path): string
    {
        $basePath = base_path();
        if (str_starts_with($path, $basePath)) {
            return substr($path, strlen($basePath) + 1);
        }

        return $path;
    }
}

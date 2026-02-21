<?php

declare(strict_types=1);

namespace Native\Agent\Commands\Query;

use Illuminate\Support\Facades\DB;
use Native\Agent\Commands\BaseCommand;
use Throwable;

class QueryExplainCommand extends BaseCommand
{
    public static function getCommandName(): string
    {
        return 'query:explain';
    }

    public function __invoke(array $params): array
    {
        $sql = $params['sql'] ?? null;
        $connection = $params['connection'] ?? null;

        if (! $sql) {
            return $this->error('No SQL provided');
        }

        try {
            $db = $connection
                ? DB::connection($connection)
                : DB::connection();

            $trimmedSql = trim($sql);
            if (! preg_match('/^EXPLAIN\s/i', $trimmedSql)) {
                $sql = 'EXPLAIN '.$sql;
            }

            $results = $db->select($sql);

            return $this->success([
                'explain' => $results,
            ]);
        } catch (Throwable $e) {
            return $this->error($e->getMessage());
        }
    }
}

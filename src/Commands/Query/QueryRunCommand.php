<?php

declare(strict_types=1);

namespace Native\src\Commands\Query;

use Illuminate\Support\Facades\DB;
use Native\src\Commands\BaseCommand;
use Throwable;

class QueryRunCommand extends BaseCommand
{
    public static function getCommandName(): string
    {
        return 'query:run';
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
            $isSelect = preg_match('/^(SELECT|SHOW|DESCRIBE|EXPLAIN|PRAGMA)\s/i', $trimmedSql);

            if ($isSelect) {
                $results = $db->select($sql);
                $columns = [];

                // Extract columns from results or via LIMIT 0 query for empty results
                if (count($results) > 0) {
                    $columns = array_keys((array) $results[0]);
                } else {
                    // For empty results, try to get columns via a LIMIT 0 wrapper
                    try {
                        $columnQuery = "SELECT * FROM ({$sql}) AS __agent_cols LIMIT 0";
                        $pdo = $db->getPdo();
                        $stmt = $pdo->prepare($columnQuery);
                        $stmt->execute();
                        for ($i = 0; $i < $stmt->columnCount(); $i++) {
                            $meta = $stmt->getColumnMeta($i);
                            if ($meta && isset($meta['name'])) {
                                $columns[] = $meta['name'];
                            }
                        }
                    } catch (Throwable $e) {
                        // Columns remain empty if we can't determine them
                    }
                }

                return $this->success([
                    'type' => 'select',
                    'rows' => $results,
                    'columns' => $columns,
                    'count' => count($results),
                ]);
            } else {
                $affected = $db->statement($sql);

                return $this->success([
                    'type' => 'statement',
                    'affected' => $affected,
                ]);
            }
        } catch (Throwable $e) {
            return $this->error($e->getMessage());
        }
    }
}

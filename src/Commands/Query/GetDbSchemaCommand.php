<?php

declare(strict_types=1);

namespace Native\src\Commands\Query;

use Illuminate\Support\Facades\DB;
use Native\src\Commands\BaseCommand;
use Throwable;

class GetDbSchemaCommand extends BaseCommand
{
    public static function getCommandName(): string
    {
        return 'get-db-schema';
    }

    public function __invoke(array $params): array
    {
        $connection = $params['connection'] ?? null;

        try {
            $db = $connection
                ? DB::connection($connection)
                : DB::connection();

            $tables = $db->select("
                SELECT name
                FROM sqlite_master
                WHERE type='table'
                AND name NOT LIKE 'sqlite_%'
                ORDER BY name
            ");

            $schema = [];

            foreach ($tables as $tableRow) {
                $tableName = $tableRow->name;

                // Get column information with type, nullable, default, primary key
                $columns = $db->select("PRAGMA table_info({$tableName})");
                $columnInfo = array_map(function ($col) {
                    return [
                        'name' => $col->name,
                        'type' => $col->type,
                        'nullable' => ! $col->notnull,
                        'default' => $col->dflt_value,
                        'primary_key' => (bool) $col->pk,
                    ];
                }, $columns);

                // Get indexes with columns
                $indexes = $db->select("PRAGMA index_list({$tableName})");
                $indexInfo = array_map(function ($idx) use ($db) {
                    $indexColumns = $db->select("PRAGMA index_info({$idx->name})");

                    return [
                        'name' => $idx->name,
                        'unique' => (bool) $idx->unique,
                        'columns' => array_map(fn ($c) => $c->name, $indexColumns),
                    ];
                }, $indexes);

                // Get foreign keys
                $foreignKeys = $db->select("PRAGMA foreign_key_list({$tableName})");
                $fkInfo = array_map(function ($fk) {
                    return [
                        'column' => $fk->from,
                        'referenced_table' => $fk->table,
                        'referenced_column' => $fk->to,
                    ];
                }, $foreignKeys);

                $schema[$tableName] = [
                    'columns' => $columnInfo,
                    'indexes' => $indexInfo,
                    'foreign_keys' => $fkInfo,
                ];
            }

            return $this->success([
                'schema' => $schema,
                'connection' => $connection ?? 'default',
                'timestamp' => time(),
            ]);
        } catch (Throwable $e) {
            return $this->error($e->getMessage());
        }
    }
}

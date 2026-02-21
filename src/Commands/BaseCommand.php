<?php

declare(strict_types=1);

namespace Native\src\Commands;

abstract class BaseCommand
{
    abstract public static function getCommandName(): string;

    /**
     * @param  array  $params  Parameters from the command request
     * @return array Response data
     */
    abstract public function __invoke(array $params): array;

    /**
     * Helper to return a success response.
     */
    protected function success(array $data = []): array
    {
        return array_merge(['success' => true], $data);
    }

    /**
     * Helper to return an error response.
     */
    protected function error(string $message, array $data = []): array
    {
        return array_merge(['success' => false, 'error' => $message], $data);
    }
}

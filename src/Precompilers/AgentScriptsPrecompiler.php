<?php

declare(strict_types=1);

namespace Native\Agent\Precompilers;

use Forte\Ast\Document\Document;
use Native\Agent\Instrumentation\AgentInstrumentation;

class AgentScriptsPrecompiler
{
    public function __invoke(string $value): string
    {
        $doc = Document::parse($value);

        $value = AgentInstrumentation::make()
            ->basePath(base_path())
            ->rewrite($doc)
            ->render();

        if (! preg_match('/<head(\s|>)/i', $value) || str_contains($value, '@agentScripts')) {
            return $value;
        }

        return preg_replace(
            '/<head(\s[^>]*)?>|<head>/i',
            "$0\n@agentScripts",
            $value,
            1
        );
    }
}

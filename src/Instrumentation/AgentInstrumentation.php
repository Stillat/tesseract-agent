<?php

declare(strict_types=1);

namespace Native\src\Instrumentation;

use Forte\Ast\Components\ComponentNode;
use Forte\Ast\Document\Document;
use Forte\Ast\Elements\ElementNode;
use Forte\Rewriting\AstRewriter;
use Forte\Rewriting\Builders\Builder;
use Forte\Rewriting\CallbackVisitor;
use Forte\Rewriting\NodePath;
use Forte\Rewriting\Rewriter;
use Illuminate\Support\Str;

class AgentInstrumentation implements AstRewriter
{
    /**
     * Component tag patterns to match.
     *
     * @var array<string>
     */
    private array $patterns = [
        'livewire:*',
        'x-*',
        'flux:*',
    ];

    /**
     * Base path for relative file paths.
     */
    private ?string $basePath = null;

    /**
     * Track which stable IDs we've already instrumented in this document.
     *
     * @var array<string, bool>
     */
    private array $instrumentedIds = [];

    private function __construct() {}

    /**
     * Create a new AgentInstrumentation instance.
     */
    public static function make(): self
    {
        return new self;
    }

    /**
     * Set custom component patterns to match.
     *
     * @param  array<string>  $patterns  Tag patterns (supports * wildcards)
     */
    public function patterns(array $patterns): self
    {
        $this->patterns = $patterns;

        return $this;
    }

    /**
     * Add patterns to the default set.
     *
     * @param  array<string>  $patterns  Additional patterns to match
     */
    public function addPatterns(array $patterns): self
    {
        $this->patterns = array_merge($this->patterns, $patterns);

        return $this;
    }

    public function basePath(string $path): self
    {
        $this->basePath = rtrim($path, '/\\');

        return $this;
    }

    /**
     * Apply the instrumentation to a document.
     */
    public function rewrite(Document $doc): Document
    {
        $this->instrumentedIds = [];

        $filePath = $doc->getFilePath();
        $relativePath = $this->makeRelativePath($filePath);

        $rewriter = new Rewriter;

        $rewriter->addVisitor(
            new CallbackVisitor(
                enter: function (NodePath $path) use ($relativePath): void {
                    $this->handleNode($path, $relativePath);
                }
            )
        );

        return $rewriter->rewrite($doc);
    }

    private function handleNode(NodePath $path, ?string $filePath): void
    {
        $node = $path->node();

        if (! $node instanceof ElementNode) {
            return;
        }

        $tagName = $node->tagNameText();

        if (! $this->matchesPatterns($tagName)) {
            return;
        }

        $line = $node->startLine();
        $depth = $path->depth();
        $componentType = $this->getComponentType($node, $tagName);
        $componentName = $this->getComponentName($node, $tagName);

        $stableId = $this->generateStableId(
            $componentType,
            $componentName,
            $filePath ?? 'unknown',
            $line,
            $depth
        );

        if (isset($this->instrumentedIds[$stableId])) {
            return;
        }
        $this->instrumentedIds[$stableId] = true;

        $startComment = $this->buildStartComment([
            'id' => $stableId,
            'type' => $componentType,
            'name' => $componentName,
            'line' => $line,
            'depth' => $depth,
            'file' => $filePath,
        ]);
        $endComment = $this->buildEndComment($stableId);

        $path->safeSurround(
            Builder::raw($startComment),
            Builder::raw($endComment)
        );
    }

    /**
     * Build the start comment marker with all metadata.
     *
     * @param  array<string, mixed>  $meta
     */
    private function buildStartComment(array $meta): string
    {
        $attrs = [];
        foreach ($meta as $key => $value) {
            if ($value !== null) {
                $escaped = htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8');
                $attrs[] = "{$key}=\"{$escaped}\"";
            }
        }

        return '<!-- [agent:start '.implode(' ', $attrs).'] -->';
    }

    /**
     * Build the end comment marker.
     */
    private function buildEndComment(string $stableId): string
    {
        $escaped = htmlspecialchars($stableId, ENT_QUOTES, 'UTF-8');

        return '<!-- [agent:end id="'.$escaped.'"] -->';
    }

    /**
     * Check if the tag name matches any of the configured patterns.
     */
    private function matchesPatterns(string $tagName): bool
    {
        foreach ($this->patterns as $pattern) {
            if (Str::is($pattern, $tagName)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Get the component type from the node.
     */
    private function getComponentType(ElementNode $node, string $tagName): string
    {
        if ($node instanceof ComponentNode) {
            $type = $node->getType();
            if ($type) {
                return $type;
            }
        }

        if (str_starts_with($tagName, 'livewire:')) {
            return 'livewire';
        }

        if (str_starts_with($tagName, 'flux:')) {
            return 'flux';
        }

        return 'blade';
    }

    /**
     * Get the component name from the node.
     */
    private function getComponentName(ElementNode $node, string $tagName): string
    {
        if ($node instanceof ComponentNode) {
            return $node->getComponentName() ?? $tagName;
        }

        if (str_starts_with($tagName, 'livewire:')) {
            return substr($tagName, 9);
        }
        if (str_starts_with($tagName, 'flux:')) {
            return substr($tagName, 5);
        }
        if (str_starts_with($tagName, 'x-')) {
            return substr($tagName, 2);
        }

        return $tagName;
    }

    private function generateStableId(
        string $type,
        string $name,
        string $filePath,
        int $line,
        int $depth
    ): string {
        $hashInput = "{$filePath}:{$line}:{$depth}";
        $hash = substr(hash('xxh64', $hashInput), 0, 8);

        return "{$type}:{$name}:{$hash}";
    }

    private function makeRelativePath(?string $filePath): ?string
    {
        if ($filePath === null) {
            return null;
        }

        $basePath = $this->basePath ?? base_path();

        if ($basePath && str_starts_with($filePath, $basePath)) {
            return ltrim(substr($filePath, strlen($basePath)), '/\\');
        }

        return $filePath;
    }
}

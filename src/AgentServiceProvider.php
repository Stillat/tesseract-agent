<?php

declare(strict_types=1);

namespace Native\src;

use Illuminate\Contracts\Http\Kernel;
use Illuminate\Support\Facades\Blade;
use Illuminate\Support\Facades\View;
use Illuminate\Support\ServiceProvider;
use Native\src\Commands\Actions\ActionsExecuteCommand as ActionsExecuteCmd;
use Native\src\Commands\Actions\ActionsManifestCommand;
use Native\src\Commands\Collectors\CollectorsCollectCommand;
use Native\src\Commands\Collectors\CollectorsManifestCommand;
use Native\src\Commands\Collectors\CollectorsRunCommand;
use Native\src\Commands\CommandRegistry;
use Native\src\Commands\Logs\LogsPollCommand;
use Native\src\Commands\Logs\LogsStartCommand;
use Native\src\Commands\Logs\LogsStopCommand;
use Native\src\Commands\Query\GetDbSchemaCommand;
use Native\src\Commands\Query\QueryExplainCommand;
use Native\src\Commands\Query\QueryRunCommand;
use Native\src\Commands\Storage\StorageDisksCommand;
use Native\src\Commands\Storage\StorageDownloadCommand;
use Native\src\Commands\Storage\StorageListCommand;
use Native\src\Commands\Storage\StorageMetaCommand;
use Native\src\Commands\Storage\StorageReadCommand;
use Native\src\Concerns\RegistersLivewireListeners;
use Native\src\Concerns\TracksQueries;
use Native\src\Console\Commands\ActionExecuteCommand;
use Native\src\Console\Commands\ActionsCommand;
use Native\src\Http\FrontendAssets;
use Native\src\Middleware\AgentMiddleware;
use Native\src\Precompilers\AgentScriptsPrecompiler;
use Throwable;

class AgentServiceProvider extends ServiceProvider
{
    use RegistersLivewireListeners;
    use TracksQueries;

    /**
     * Register services.
     */
    public function register(): void
    {
        $this->mergeConfigFrom(
            __DIR__.'/../config/agent.php',
            'agent'
        );

        $this->app->singleton(AgentConnector::class, function () {
            return new AgentConnector;
        });

        $this->app->singleton(DiscoveryWriter::class, function () {
            return new DiscoveryWriter;
        });

        // Register CollectorManager
        $this->app->singleton(Collectors\CollectorManager::class, function ($app) {
            return new Collectors\CollectorManager(
                $app->make(AgentConnector::class),
                $app->environment()
            );
        });

        // Register ActionManager
        $this->app->singleton(Actions\ActionManager::class, function ($app) {
            return new Actions\ActionManager(
                $app->make(AgentConnector::class),
                $app->environment()
            );
        });

        $this->app->singleton(CommandRegistry::class, function ($app) {
            $registry = new CommandRegistry($app);

            $registry->registerMany([
                // Logs
                LogsStartCommand::class,
                LogsPollCommand::class,
                LogsStopCommand::class,

                // Query
                QueryRunCommand::class,
                QueryExplainCommand::class,
                GetDbSchemaCommand::class,

                // Storage
                StorageDisksCommand::class,
                StorageListCommand::class,
                StorageReadCommand::class,
                StorageMetaCommand::class,
                StorageDownloadCommand::class,

                // Collectors
                CollectorsManifestCommand::class,
                CollectorsCollectCommand::class,
                CollectorsRunCommand::class,

                // Actions
                ActionsManifestCommand::class,
                ActionsExecuteCmd::class,
            ]);

            return $registry;
        });
    }

    /**
     * Bootstrap services.
     */
    public function boot(): void
    {
        if ($this->app->runningInConsole()) {
            $this->publishes([
                __DIR__.'/../config/agent.php' => $this->app->configPath('agent.php'),
            ], 'agent-config');

            $this->publishes([
                __DIR__.'/../resources/views' => $this->app->resourcePath('views/vendor/agent'),
            ], 'agent-views');

            // Register artisan commands
            $this->commands([
                ActionExecuteCommand::class,
                ActionsCommand::class,
            ]);
        }

        if (! $this->isEnabledEnvironment()) {
            return;
        }

        $this->loadViewsFrom(__DIR__.'/../resources/views', 'agent');

        FrontendAssets::registerRoutes();

        $this->app->make(DiscoveryWriter::class)->updateIfNeeded();

        if (config('agent.features.request_tracking', true)) {
            $this->registerMiddleware();
        }

        $connector = $this->app->make(AgentConnector::class);

        View::composer('*', function ($view) use ($connector) {
            if (! $view->offsetExists('agentConfig')) {
                $view->with('agentConfig', $connector->getConfig());
            }
        });

        Blade::directive('agentScripts', function () {
            return "<?php echo view('agent::config', [
                'agentConfig' => app(\\Native\\Agent\\AgentConnector::class)->getConfig(),
                'bundledScript' => \\Native\\Agent\\Http\\FrontendAssets::getBundledContent()
            ])->render(); ?>";
        });

        if (config('agent.features.auto_inject_scripts', true)) {
            Blade::prepareStringsForCompilationUsing(new AgentScriptsPrecompiler);
        }

        if (config('agent.features.query_tracking', true)) {
            $this->registerQueryListener($connector);
        }

        if (config('agent.features.livewire_support', true)) {
            $this->registerLivewireListeners($connector);
        }

        if (config('agent.features.collectors', true)) {
            $this->initializeCollectors();
        }
    }

    /**
     * Initialize collectors and actions.
     */
    protected function initializeCollectors(): void
    {
        try {
            $collectorManager = $this->app->make(Collectors\CollectorManager::class);
            $collectorManager->discover();

            $actionManager = $this->app->make(Actions\ActionManager::class);
            $actionManager->discover();
        } catch (Throwable $e) {
        }
    }

    /**
     * Check if Agent should be enabled in the current environment.
     */
    protected function isEnabledEnvironment(): bool
    {
        $environments = config('agent.environments', ['local']);

        if (in_array('*', $environments, true)) {
            return true;
        }

        return $this->app->environment($environments);
    }

    /**
     * Register the Agent middleware.
     */
    protected function registerMiddleware(): void
    {
        $kernel = $this->app->make(Kernel::class);

        $kernel->appendMiddlewareToGroup('web', AgentMiddleware::class);
    }
}

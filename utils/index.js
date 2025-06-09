/**
 * PATRÓN SINGLETON - ComponentLoader
 * Gestiona la carga y el estado de todos los componentes de la aplicación
 */
class ComponentLoader {
  constructor() {
    if (ComponentLoader.instance) {
      return ComponentLoader.instance;
    }

    this.loadedComponents = new Map();
    this.loadingPromises = new Map();
    this.config = new ComponentConfig();
    ComponentLoader.instance = this;
  }

  static getInstance() {
    return new ComponentLoader();
  }

  /**
   * PATRÓN FACTORY - Crea diferentes tipos de loaders según el tipo de componente
   */
  createLoader(type) {
    const loaders = {
      html: new HtmlComponentLoader(),
      dynamic: new DynamicComponentLoader(),
      lazy: new LazyComponentLoader(),
    };

    return loaders[type] || loaders["html"];
  }

  /**
   * PATRÓN STRATEGY - Diferentes estrategias de carga
   */
  async loadComponent(componentName, strategy = "html") {
    // Evitar cargas duplicadas
    if (this.loadingPromises.has(componentName)) {
      return this.loadingPromises.get(componentName);
    }

    const loader = this.createLoader(strategy);
    const componentConfig = this.config.getComponentConfig(componentName);

    if (!componentConfig) {
      throw new ComponentError(
        `Configuración no encontrada para: ${componentName}`
      );
    }

    // Cache de la promesa para evitar múltiples cargas simultáneas
    const loadingPromise = this.executeLoad(loader, componentConfig);
    this.loadingPromises.set(componentName, loadingPromise);

    try {
      const result = await loadingPromise;
      this.loadedComponents.set(componentName, result);
      return result;
    } finally {
      this.loadingPromises.delete(componentName);
    }
  }

  async executeLoad(loader, config) {
    const container = this.getContainer(config.containerId);
    this.setLoadingState(container, true);

    try {
      const result = await loader.load(config);
      this.renderComponent(container, result, config);
      this.executePostLoadActions(result.element, config);
      return result;
    } catch (error) {
      this.handleLoadError(container, error, config);
      throw error;
    } finally {
      this.setLoadingState(container, false);
    }
  }

  getContainer(containerId) {
    const container = document.getElementById(containerId);
    if (!container) {
      throw new ComponentError(`Contenedor ${containerId} no encontrado`);
    }
    return container;
  }

  setLoadingState(container, isLoading) {
    container.setAttribute("aria-busy", isLoading.toString());

    if (isLoading) {
      container.classList.add("loading");
    } else {
      container.classList.remove("loading");
    }
  }

  renderComponent(container, componentResult, config) {
    container.innerHTML = "";

    if (config.animationClass) {
      componentResult.element.classList.add(config.animationClass);
    }

    container.appendChild(componentResult.element);
  }

  executePostLoadActions(element, config) {
    if (config.onLoad && typeof config.onLoad === "function") {
      try {
        config.onLoad(element);
      } catch (error) {
        console.error(`Error en callback onLoad para ${config.path}:`, error);
      }
    }
  }

  handleLoadError(container, error, config) {
    console.error(`Error cargando componente ${config.path}:`, error);

    const errorHandler = new ComponentErrorHandler();
    errorHandler.showError(container, error, config);
    console.error("Error completo:", { error, config }); // 👈 Log completo
  }

  // Método para cargar múltiples componentes en paralelo
  async loadMultipleComponents(componentNames) {
    const loadPromises = componentNames.map((name) =>
      this.loadComponent(name).catch((error) => ({
        error,
        componentName: name,
      }))
    );

    return await Promise.allSettled(loadPromises);
  }
}

/**
 * PATRÓN STRATEGY - Interfaz base para diferentes estrategias de carga
 */
class ComponentLoaderStrategy {
  async load(config) {
    throw new Error("Método load() debe ser implementado por la subclase");
  }
}

/**
 * Estrategia para cargar componentes HTML estáticos
 */
class HtmlComponentLoader extends ComponentLoaderStrategy {
  async load(config) {
    const [htmlContent, cssLoaded] = await Promise.all([
      this.fetchHtml(config),
      this.loadCSS(config),
    ]);

    return {
      element: htmlContent,
      cssLoaded,
      type: "html",
    };
  }

  async fetchHtml(config) {
    const htmlPath = this.buildHtmlPath(config.path);
    const response = await fetch(htmlPath);

    if (!response.ok) {
      throw new ComponentError(
        `HTTP error! status: ${response.status} para ${htmlPath}`
      );
    }

    const html = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    const element = doc.querySelector(config.elementSelector);

    if (!element) {
      throw new ComponentError(
        `Elemento ${config.elementSelector} no encontrado en ${htmlPath}`
      );
    }

    return element;
  }

  buildHtmlPath(path) {
    return path.endsWith("/") ? `${path}index.html` : `${path}/index.html`;
  }

  async loadCSS(config) {
    if (!config.cssFile) return true;

    const cssPath = `${config.path}${config.cssFile}`;
    return new Promise((resolve) => {
      // Verificar si el CSS ya está cargado
      const existingLink = document.getElementById(`css-${config.containerId}`);
      if (existingLink) {
        resolve(true);
        return;
      }

      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = cssPath;
      link.id = `css-${config.containerId}`;

      link.onload = () => resolve(true);
      link.onerror = () => {
        console.warn(`No se pudo cargar CSS: ${cssPath}`);
        resolve(false);
      };

      document.head.appendChild(link);
    });
  }
}

/**
 * Estrategia para componentes dinámicos (con JavaScript)
 */
class DynamicComponentLoader extends HtmlComponentLoader {
  async load(config) {
    const result = await super.load(config);

    if (config.scriptFile) {
      await this.loadScript(config);
    }

    return { ...result, type: "dynamic" };
  }

  async loadScript(config) {
    const scriptPath = `${config.path}${config.scriptFile}`;

    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = scriptPath;
      script.defer = true;
      script.onload = resolve;
      script.onerror = () =>
        reject(new ComponentError(`Error cargando script: ${scriptPath}`));

      document.head.appendChild(script);
    });
  }
}

/**
 * Estrategia para carga lazy (bajo demanda)
 */
class LazyComponentLoader extends HtmlComponentLoader {
  async load(config) {
    // Implementar Intersection Observer para carga lazy
    const result = await super.load(config);

    return { ...result, type: "lazy" };
  }
}

/**
 * PATRÓN BUILDER - Constructor de configuraciones de componentes
 */
class ComponentConfigBuilder {
  constructor() {
    this.reset();
  }

  reset() {
    this.config = {
      path: "",
      containerId: "",
      elementSelector: "",
      animationClass: null,
      cssFile: null,
      scriptFile: null,
      onLoad: null,
      loadStrategy: "html",
    };
    return this;
  }

  setPath(path) {
    this.config.path = path;
    return this;
  }

  setContainer(containerId) {
    this.config.containerId = containerId;
    return this;
  }

  setSelector(elementSelector) {
    this.config.elementSelector = elementSelector;
    return this;
  }

  setAnimation(animationClass) {
    this.config.animationClass = animationClass;
    return this;
  }

  setCSS(cssFile) {
    this.config.cssFile = cssFile;
    return this;
  }

  setScript(scriptFile) {
    this.config.scriptFile = scriptFile;
    return this;
  }

  setOnLoad(callback) {
    this.config.onLoad = callback;
    return this;
  }

  setStrategy(strategy) {
    this.config.loadStrategy = strategy;
    return this;
  }

  build() {
    // Validaciones
    if (
      !this.config.path ||
      !this.config.containerId ||
      !this.config.elementSelector
    ) {
      throw new ComponentError(
        "Configuración incompleta: path, containerId y elementSelector son requeridos"
      );
    }

    const result = { ...this.config };
    this.reset();
    return result;
  }
}

/**
 * PATRÓN REGISTRY - Registro centralizado de configuraciones
 */
class ComponentConfig {
  constructor() {
    this.components = new Map();
    this.initializeDefaultComponents();
  }

  initializeDefaultComponents() {
    const builder = new ComponentConfigBuilder();

    // Banner
    this.register(
      "banner",
      builder
        .setPath("/banner/")
        .setContainer("banner-container")
        .setSelector("section")
        .setAnimation("fade-in-down")
        .setCSS("banner.css")
        .build()
    );

    // Header
    this.register(
      "header",
      builder
        .setPath("/header/")
        .setContainer("header-container")
        .setSelector("header")
        .setAnimation("fade-in-left-header")
        .setOnLoad((element) => this.initMobileMenu(element))
        .setStrategy("dynamic")
        .setScript("header.js")
        .build()
    );

    // Hero
    this.register(
      "hero",
      builder
        .setPath("/hero/")
        .setContainer("hero-container")
        .setSelector("section")
        .setAnimation("scale-up-animation")
        .build()
    );

    // Section 2
    this.register(
      "section-2",
      builder
        .setPath("/section_2/")
        .setContainer("section_2")
        .setSelector("section")
        .setAnimation("scale-up-animation")
        .build()
    );

    // Categories Section
    this.register(
      "categories",
      builder
        .setPath("/categories/")
        .setContainer("categories")
        .setSelector("section")
        // .setAnimation("scale-up-animation")
        .build()
    );
  }

  register(name, config) {
    this.components.set(name, config);
  }

  getComponentConfig(name) {
    return this.components.get(name);
  }

  getAllComponents() {
    return Array.from(this.components.keys());
  }

  // Método auxiliar que debería estar en un módulo separado
  initMobileMenu(headerElement) {
    const menuButton = headerElement.querySelector(".mobile-menu-button");
    if (menuButton) {
      menuButton.addEventListener("click", () => {
        headerElement.classList.toggle("menu-open");
      });
    }
  }
}

/**
 * PATRÓN CUSTOM ERROR - Manejo específico de errores de componentes
 */
class ComponentError extends Error {
  constructor(message, componentName = "", originalError = null) {
    super(message);
    this.name = "ComponentError";
    this.componentName = componentName;
    this.originalError = originalError;
    this.timestamp = new Date().toISOString();
  }
}

/**
 * PATRÓN STRATEGY para manejo de errores
 */
class ComponentErrorHandler {
  showError(container, error, config) {
    const errorTemplate = this.createErrorTemplate(error, config);
    container.innerHTML = errorTemplate;
    this.attachRetryHandler(container, config);
    this.logError(error, config);
  }

  createErrorTemplate(error, config) {
    return `
      <div class="component-error" role="alert" data-component="${config.containerId}">
        <div class="error-icon">
          <i class="fas fa-exclamation-triangle" aria-hidden="true"></i>
        </div>
        <div class="error-content">
          <h3 class="error-title">Error cargando contenido</h3>
          <p class="error-message">${this.sanitizeErrorMessage(error.message)}</p>
          <div class="error-actions">
            <button class="retry-btn" aria-label="Reintentar carga del componente">
              <i class="fas fa-sync-alt" aria-hidden="true"></i>
              Reintentar
            </button>
          </div>
        </div>
      </div>
    `;
  }

  sanitizeErrorMessage(message) {
    // Sanitizar mensaje para evitar XSS
    const div = document.createElement("div");
    div.textContent = message;
    return div.innerHTML;
  }

  attachRetryHandler(container, config) {
    const retryBtn = container.querySelector(".retry-btn");
    if (retryBtn) {
      retryBtn.addEventListener("click", async () => {
        try {
          const loader = ComponentLoader.getInstance();
          await loader.loadComponent(config.containerId);
        } catch (error) {
          console.error("Error en reintento:", error);
        }
      });
    }
  }

  logError(error, config) {
    const errorInfo = {
      component: config.containerId,
      path: config.path,
      error: error.message,
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
    };

    console.error("Component Load Error:", errorInfo);

    // Aquí podrías enviar el error a un servicio de logging
    // this.sendErrorToService(errorInfo);
  }
}

/**
 * PATRÓN FACADE - Interfaz simplificada para usar el sistema
 */
class ComponentManager {
  constructor() {
    this.loader = ComponentLoader.getInstance();
  }

  async initialize() {
    const config = new ComponentConfig();
    const allComponents = config.getAllComponents();

    try {
      const results = await this.loader.loadMultipleComponents(allComponents);
      this.logInitializationResults(results);
      return results;
    } catch (error) {
      console.error("Error durante la inicialización:", error);
      throw error;
    }
  }

  async loadComponent(name, strategy = "html") {
    return await this.loader.loadComponent(name, strategy);
  }

  logInitializationResults(results) {
    const successful = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r) => r.status === "rejected").length;

    console.log(
      `Componentes cargados: ${successful} exitosos, ${failed} fallidos`
    );

    if (failed > 0) {
      const failedComponents = results
        .filter((r) => r.status === "rejected")
        .map((r) => r.reason);
      console.warn("Componentes fallidos:", failedComponents);
    }
  }
}

/**
 * INICIALIZACIÓN Y USO
 */
// Función principal de inicialización
async function initializeApp() {
  try {
    const manager = new ComponentManager();
    await manager.initialize();
    console.log("Aplicación inicializada correctamente");
  } catch (error) {
    console.error("Error inicializando aplicación:", error);
  }
}

// Auto-inicialización cuando el DOM esté listo
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeApp);
} else {
  initializeApp();
}

// Exportar para uso externo si es necesario
window.ComponentManager = ComponentManager;
window.ComponentLoader = ComponentLoader;

/**
 * EJEMPLO DE USO AVANZADO:
 *
 * // Cargar un componente específico
 * const manager = new ComponentManager();
 * await manager.loadComponent('header', 'dynamic');
 *
 * // Crear configuración personalizada
 * const builder = new ComponentConfigBuilder();
 * const customConfig = builder
 *   .setPath('/custom-component/')
 *   .setContainer('custom-container')
 *   .setSelector('.custom-element')
 *   .setAnimation('custom-animation')
 *   .build();
 *
 * // Registrar y cargar componente personalizado
 * const config = new ComponentConfig();
 * config.register('custom', customConfig);
 * await manager.loadComponent('custom');
 */

export {};

declare global {
  interface Window {
    DocsAPI?: {
      DocEditor: new (element: HTMLElement, config: any) => any;
    };
  }
}

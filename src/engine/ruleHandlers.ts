import type { AsyncRuleHandler } from "../types.js";

/** Immutable registry of async rule handlers. Extend it with `with` for a custom evaluator. */
export class RuleHandlerRegistry {
    private readonly handlers: ReadonlyMap<string, AsyncRuleHandler<any>>;

    constructor(handlers: readonly AsyncRuleHandler<any>[] = []) {
        const byType = new Map<string, AsyncRuleHandler<any>>();
        for (const handler of handlers) {
            if (byType.has(handler.type)) {
                throw new Error(`Duplicate async rule handler: ${handler.type}`);
            }
            byType.set(handler.type, handler);
        }
        this.handlers = byType;
    }

    get(type: string): AsyncRuleHandler<any> | undefined {
        return this.handlers.get(type);
    }

    has(type: string): boolean {
        return this.handlers.has(type);
    }

    all(): readonly AsyncRuleHandler<any>[] {
        return [...this.handlers.values()];
    }

    with<Prepared>(handler: AsyncRuleHandler<Prepared>): RuleHandlerRegistry {
        if (this.has(handler.type)) {
            throw new Error(`Async rule handler already registered: ${handler.type}`);
        }
        return new RuleHandlerRegistry([...this.handlers.values(), handler]);
    }
}

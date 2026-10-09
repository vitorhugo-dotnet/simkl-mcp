import type { SimklClient } from '../api/client.js';
import type { SimklLibraryCache } from './cache.js';
import { normalizeSimklId, resolveSimklUserId } from './identity.js';
import type { LibraryInitialization, LibraryItemRow } from './types.js';

/** Session adapter: resolve trusted identity; leave all library fetching to the object. */
export class LibraryService {
  private verifiedId?: string;
  private resolvingId?: Promise<string>;

  constructor(
    private readonly client: SimklClient,
    private readonly namespace: DurableObjectNamespace<SimklLibraryCache>,
    private readonly getAuth: () => { simklToken: string; simklUserId?: string },
  ) {}

  private async objectForOperation() {
    const auth = this.getAuth();
    if (!auth.simklToken) throw new Error('Simkl authentication required');
    const known = normalizeSimklId(auth.simklUserId);
    if (known) this.verifiedId = known;
    if (!this.verifiedId) {
      if (!this.resolvingId) {
        this.resolvingId = resolveSimklUserId(this.client, auth.simklToken)
          .then(id => { this.verifiedId = id; return id; })
          .finally(() => { this.resolvingId = undefined; });
      }
      await this.resolvingId;
    }
    const id = this.namespace.idFromName(`simkl-library:v1:${this.verifiedId}`);
    return { object: this.namespace.get(id), token: auth.simklToken };
  }

  async ensureInitialized(): Promise<LibraryInitialization> {
    const { object, token } = await this.objectForOperation();
    return object.ensureInitialized(token);
  }

  async readItems(): Promise<LibraryItemRow[]> {
    const { object, token } = await this.objectForOperation();
    await object.ensureInitialized(token);
    return object.readItems();
  }
}

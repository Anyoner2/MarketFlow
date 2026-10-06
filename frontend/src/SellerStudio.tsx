import { useEffect, useState, type FormEvent } from 'react'

type Store = {
  id: number
  name: string
  slug: string
  description: string
  is_active: boolean
}

type SellerProduct = {
  id: number
  store_id: number
  name: string
  category: string
  price: string
  description: string
  image_url: string
  stock_quantity: number
  is_active: boolean
}

type SellerStudioProps = {
  apiBaseUrl: string
  token: string
  onClose: () => void
  onCatalogChanged: () => Promise<void>
  onNotice: (message: string) => void
}

async function apiRequest(apiBaseUrl: string, token: string, path: string, options: RequestInit = {}) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  })

  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    const messages = Object.values(data as Record<string, unknown>)
      .flatMap((value) => Array.isArray(value) ? value : [value])
      .filter((value): value is string => typeof value === 'string')
    throw new Error(messages.join(' ') || `Request failed (${response.status}).`)
  }

  return response.status === 204 ? null : response.json()
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function SellerStudio({ apiBaseUrl, token, onClose, onCatalogChanged, onNotice }: SellerStudioProps) {
  const [stores, setStores] = useState<Store[]>([])
  const [products, setProducts] = useState<SellerProduct[]>([])
  const [selectedStoreId, setSelectedStoreId] = useState('')
  const [storeName, setStoreName] = useState('')
  const [storeSlug, setStoreSlug] = useState('')
  const [storeDescription, setStoreDescription] = useState('')
  const [productName, setProductName] = useState('')
  const [productCategory, setProductCategory] = useState('Other')
  const [productPrice, setProductPrice] = useState('')
  const [productStock, setProductStock] = useState('0')
  const [productDescription, setProductDescription] = useState('')
  const [productImageUrl, setProductImageUrl] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let active = true
    Promise.all([
      apiRequest(apiBaseUrl, token, '/api/stores/'),
      apiRequest(apiBaseUrl, token, '/api/seller/products/'),
    ])
      .then(([storeData, productData]) => {
        if (!active) return
        const loadedStores = storeData as Store[]
        setStores(loadedStores)
        setProducts(productData as SellerProduct[])
        setSelectedStoreId((current) => current || (loadedStores[0] ? String(loadedStores[0].id) : ''))
      })
      .catch((error: unknown) => {
        if (active) onNotice(error instanceof Error ? error.message : 'Could not load your seller workspace.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [apiBaseUrl, token, onNotice])

  async function createStore(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    try {
      const store = await apiRequest(apiBaseUrl, token, '/api/stores/', {
        method: 'POST',
        body: JSON.stringify({ name: storeName, slug: storeSlug, description: storeDescription }),
      }) as Store
      setStores((current) => [store, ...current])
      setSelectedStoreId(String(store.id))
      setStoreName('')
      setStoreSlug('')
      setStoreDescription('')
      onNotice('Your store is ready.')
    } catch (error) {
      onNotice(error instanceof Error ? error.message : 'Could not create your store.')
    } finally {
      setBusy(false)
    }
  }

  async function createProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    try {
      const product = await apiRequest(apiBaseUrl, token, '/api/seller/products/', {
        method: 'POST',
        body: JSON.stringify({
          store_id: Number(selectedStoreId),
          name: productName,
          category: productCategory,
          price: productPrice,
          stock_quantity: Number(productStock),
          description: productDescription,
          image_url: productImageUrl,
        }),
      }) as SellerProduct
      setProducts((current) => [product, ...current])
      setProductName('')
      setProductCategory('Other')
      setProductPrice('')
      setProductStock('0')
      setProductDescription('')
      setProductImageUrl('')
      await onCatalogChanged()
      onNotice('Your listing is live.')
    } catch (error) {
      onNotice(error instanceof Error ? error.message : 'Could not create your listing.')
    } finally {
      setBusy(false)
    }
  }

  async function toggleProduct(product: SellerProduct) {
    setBusy(true)
    try {
      const updated = await apiRequest(apiBaseUrl, token, `/api/seller/products/${product.id}/`, {
        method: 'PATCH',
        body: JSON.stringify({ is_active: !product.is_active }),
      }) as SellerProduct
      setProducts((current) => current.map((item) => item.id === updated.id ? updated : item))
      await onCatalogChanged()
      onNotice(updated.is_active ? 'Listing published.' : 'Listing paused.')
    } catch (error) {
      onNotice(error instanceof Error ? error.message : 'Could not update the listing.')
    } finally {
      setBusy(false)
    }
  }

  async function deleteProduct(product: SellerProduct) {
    if (!window.confirm(`Remove “${product.name}” from your listings?`)) return
    setBusy(true)
    try {
      await apiRequest(apiBaseUrl, token, `/api/seller/products/${product.id}/`, { method: 'DELETE' })
      setProducts((current) => current.filter((item) => item.id !== product.id))
      await onCatalogChanged()
      onNotice('Listing removed.')
    } catch (error) {
      onNotice(error instanceof Error ? error.message : 'Could not remove the listing.')
    } finally {
      setBusy(false)
    }
  }

  const visibleProducts = products.filter((product) => String(product.store_id) === selectedStoreId)

  return (
    <div className="seller-backdrop" onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="seller-studio" role="dialog" aria-modal="true" aria-labelledby="seller-title">
        <header className="seller-header">
          <div>
            <p className="eyebrow">MARKETFLOW SELLER</p>
            <h2 id="seller-title">Your shop</h2>
          </div>
          <button className="seller-close" aria-label="Close seller studio" onClick={onClose}>×</button>
        </header>

        {loading ? <p className="seller-loading">Loading your shop…</p> : stores.length === 0 ? (
          <section className="seller-section">
            <h3>Open your store</h3>
            <form className="seller-form" onSubmit={createStore}>
              <label>Store name<input value={storeName} onChange={(event) => { setStoreName(event.target.value); setStoreSlug(slugify(event.target.value)) }} maxLength={160} required /></label>
              <label>Store URL<input value={storeSlug} onChange={(event) => setStoreSlug(slugify(event.target.value))} maxLength={160} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" required /></label>
              <label className="seller-wide">Description<textarea value={storeDescription} onChange={(event) => setStoreDescription(event.target.value)} rows={3} /></label>
              <button className="dark-button" type="submit" disabled={busy}>Create store <span aria-hidden="true">↗</span></button>
            </form>
          </section>
        ) : (
          <>
            <div className="seller-store-bar">
              <label>Store<select value={selectedStoreId} onChange={(event) => setSelectedStoreId(event.target.value)}>
                {stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
              </select></label>
              <span>{visibleProducts.length} listing{visibleProducts.length === 1 ? '' : 's'}</span>
            </div>

            <section className="seller-section">
              <h3>Add a listing</h3>
              <form className="seller-form" onSubmit={createProduct}>
                <label>Product name<input value={productName} onChange={(event) => setProductName(event.target.value)} maxLength={160} required /></label>
                <label>Category<input value={productCategory} onChange={(event) => setProductCategory(event.target.value)} maxLength={60} required /></label>
                <label>Price (KES)<input type="number" min="0" step="0.01" value={productPrice} onChange={(event) => setProductPrice(event.target.value)} required /></label>
                <label>Stock<input type="number" min="0" step="1" value={productStock} onChange={(event) => setProductStock(event.target.value)} required /></label>
                <label className="seller-wide">Description<textarea value={productDescription} onChange={(event) => setProductDescription(event.target.value)} rows={2} /></label>
                <label className="seller-wide">Image URL<input type="url" value={productImageUrl} onChange={(event) => setProductImageUrl(event.target.value)} /></label>
                <button className="dark-button" type="submit" disabled={busy}>Add listing <span aria-hidden="true">↗</span></button>
              </form>
            </section>

            <section className="seller-section seller-listings">
              <h3>Listings</h3>
              {visibleProducts.length === 0 ? <p className="seller-empty">Your store has no listings yet.</p> : visibleProducts.map((product) => (
                <article className="seller-product" key={product.id}>
                  <div className="seller-product-copy">
                    <p className="product-category">{product.category} · {product.is_active ? 'Live' : 'Paused'}</p>
                    <h4>{product.name}</h4>
                    <p>KSh {Number(product.price).toLocaleString('en-KE', { maximumFractionDigits: 2 })} <span>·</span> {product.stock_quantity} in stock</p>
                  </div>
                  <div className="seller-product-actions">
                    <button type="button" disabled={busy} onClick={() => void toggleProduct(product)}>{product.is_active ? 'Pause' : 'Publish'}</button>
                    <button type="button" className="seller-delete" disabled={busy} onClick={() => void deleteProduct(product)}>Remove</button>
                  </div>
                </article>
              ))}
            </section>
          </>
        )}
      </section>
    </div>
  )
}

export default SellerStudio
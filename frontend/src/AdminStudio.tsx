import { useCallback, useEffect, useState } from 'react'

type AdminSummary = {
  active_users: number
  active_sellers: number
  pending_seller_applications: number
  live_products: number
  suspended_products: number
  paid_orders: number
  pending_payments: number
  gross_sales: string
}

type AdminUser = {
  id: number
  email: string
  first_name: string
  role: 'customer' | 'seller' | 'admin'
  is_active: boolean
  seller_requested: boolean
  created_at: string
}

type AdminCategory = {
  id: number
  name: string
  product_count: number
}

type AdminOrder = {
  id: number
  order_number: string
  payment_status: string
  status: string
  customer_email: string
  total_amount: string
  item_count: number
  created_at: string
}

type AdminProduct = {
  id: number
  name: string
  category: string
  price: string
  is_active: boolean
  is_suspended: boolean
  stock_quantity: number
  store_name: string
  seller_email: string
}

type AdminStudioProps = {
  apiBaseUrl: string
  token: string
  onClose: () => void
  onNotice: (message: string) => void
}

type AdminTab = 'overview' | 'users' | 'categories' | 'orders' | 'products'

async function adminRequest<T>(apiBaseUrl: string, token: string, path: string, options: RequestInit = {}): Promise<T> {
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
    throw new Error(data.detail || `Request failed (${response.status}).`)
  }
  return response.status === 204 ? null as T : response.json()
}

function AdminStudio({ apiBaseUrl, token, onClose, onNotice }: AdminStudioProps) {
  const [activeTab, setActiveTab] = useState<AdminTab>('overview')
  const [summary, setSummary] = useState<AdminSummary | null>(null)
  const [users, setUsers] = useState<AdminUser[]>([])
  const [categories, setCategories] = useState<AdminCategory[]>([])
  const [orders, setOrders] = useState<AdminOrder[]>([])
  const [products, setProducts] = useState<AdminProduct[]>([])
  const [categoryName, setCategoryName] = useState('')
  const [busyKey, setBusyKey] = useState('')

  const fetchAdminData = useCallback(() => Promise.all([
      adminRequest<AdminSummary>(apiBaseUrl, token, '/api/admin/summary/'),
      adminRequest<AdminUser[]>(apiBaseUrl, token, '/api/admin/users/'),
      adminRequest<AdminCategory[]>(apiBaseUrl, token, '/api/admin/categories/'),
      adminRequest<AdminOrder[]>(apiBaseUrl, token, '/api/admin/orders/'),
      adminRequest<AdminProduct[]>(apiBaseUrl, token, '/api/admin/products/'),
    ]), [apiBaseUrl, token])

  const reload = useCallback(async () => {
    const [summaryData, userData, categoryData, orderData, productData] = await fetchAdminData()
    setSummary(summaryData)
    setUsers(userData)
    setCategories(categoryData)
    setOrders(orderData)
    setProducts(productData)
  }, [fetchAdminData])

  useEffect(() => {
    let active = true
    void fetchAdminData()
      .then(([summaryData, userData, categoryData, orderData, productData]) => {
        if (!active) return
        setSummary(summaryData)
        setUsers(userData)
        setCategories(categoryData)
        setOrders(orderData)
        setProducts(productData)
      })
      .catch((error: unknown) => {
        if (active) onNotice(error instanceof Error ? error.message : 'Could not load the admin console.')
      })
    return () => { active = false }
  }, [fetchAdminData, onNotice])

  async function updateUser(user: AdminUser, updates: Partial<Pick<AdminUser, 'role' | 'is_active' | 'seller_requested'>>) {
    setBusyKey(`user-${user.id}`)
    try {
      await adminRequest(apiBaseUrl, token, `/api/admin/users/${user.id}/`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
      })
      await reload()
      onNotice(updates.role === 'seller' ? 'Seller account approved.' : 'Account updated.')
    } catch (error) {
      onNotice(error instanceof Error ? error.message : 'Could not update account.')
    } finally {
      setBusyKey('')
    }
  }

  async function saveCategory(category?: AdminCategory) {
    const name = category ? window.prompt('Category name', category.name)?.trim() : categoryName.trim()
    if (!name) return
    setBusyKey(category ? `category-${category.id}` : 'category-new')
    try {
      if (category) {
        await adminRequest(apiBaseUrl, token, `/api/admin/categories/${category.id}/`, {
          method: 'PATCH',
          body: JSON.stringify({ name }),
        })
      } else {
        await adminRequest(apiBaseUrl, token, '/api/admin/categories/', {
          method: 'POST',
          body: JSON.stringify({ name }),
        })
      }
      setCategoryName('')
      await reload()
      onNotice(category ? 'Category renamed.' : 'Category added.')
    } catch (error) {
      onNotice(error instanceof Error ? error.message : 'Could not save category.')
    } finally {
      setBusyKey('')
    }
  }

  async function deleteCategory(category: AdminCategory) {
    if (!window.confirm(`Delete “${category.name}”? Categories with products cannot be deleted.`)) return
    setBusyKey(`category-${category.id}`)
    try {
      await adminRequest(apiBaseUrl, token, `/api/admin/categories/${category.id}/`, { method: 'DELETE' })
      await reload()
      onNotice('Category deleted.')
    } catch (error) {
      onNotice(error instanceof Error ? error.message : 'Could not delete category.')
    } finally {
      setBusyKey('')
    }
  }

  async function suspendProduct(product: AdminProduct) {
    setBusyKey(`product-${product.id}`)
    try {
      await adminRequest(apiBaseUrl, token, `/api/admin/products/${product.id}/`, {
        method: 'PATCH',
        body: JSON.stringify({ is_suspended: !product.is_suspended }),
      })
      await reload()
      onNotice(product.is_suspended ? 'Product reinstated.' : 'Product suspended.')
    } catch (error) {
      onNotice(error instanceof Error ? error.message : 'Could not update product.')
    } finally {
      setBusyKey('')
    }
  }

  const tabs: Array<{ id: AdminTab; label: string }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'users', label: 'Users & sellers' },
    { id: 'categories', label: 'Categories' },
    { id: 'orders', label: 'Orders' },
    { id: 'products', label: 'Products' },
  ]

  return (
    <div className="seller-backdrop" onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="seller-studio admin-studio" role="dialog" aria-modal="true" aria-labelledby="admin-title">
        <header className="seller-header">
          <div><p className="eyebrow">MARKETFLOW ADMIN</p><h2 id="admin-title">Platform console</h2></div>
          <button className="seller-close" aria-label="Close admin console" onClick={onClose}>×</button>
        </header>
        <nav className="admin-tabs" aria-label="Admin sections">
          {tabs.map((tab) => <button key={tab.id} type="button" className={activeTab === tab.id ? 'active' : ''} onClick={() => setActiveTab(tab.id)}>{tab.label}</button>)}
        </nav>
        {summary === null ? <p className="seller-loading">Loading platform data…</p> : <>
          {activeTab === 'overview' && summary && <section className="seller-dashboard admin-dashboard" aria-label="Platform analytics">
            <article><span>ACTIVE USERS</span><strong>{summary.active_users}</strong></article>
            <article><span>ACTIVE SELLERS</span><strong>{summary.active_sellers}</strong></article>
            <article><span>SELLER REQUESTS</span><strong>{summary.pending_seller_applications}</strong></article>
            <article><span>LIVE PRODUCTS</span><strong>{summary.live_products}</strong></article>
            <article><span>SUSPENDED PRODUCTS</span><strong>{summary.suspended_products}</strong></article>
            <article><span>PAID ORDERS</span><strong>{summary.paid_orders}</strong></article>
            <article><span>PENDING PAYMENTS</span><strong>{summary.pending_payments}</strong></article>
            <article><span>GROSS SALES</span><strong>KSh {Number(summary.gross_sales).toLocaleString('en-KE')}</strong></article>
          </section>}

          {activeTab === 'users' && <section className="seller-section admin-section">
            <h3>Accounts and seller approvals</h3>
            {users.map((user) => <article className="admin-row" key={user.id}>
              <div className="admin-row-copy"><strong>{user.first_name || user.email}</strong><span>{user.email}</span><small>{user.role} · {user.is_active ? 'active' : 'suspended'}</small></div>
              <div className="admin-row-actions">
                {user.seller_requested && <>
                  <button type="button" disabled={busyKey === `user-${user.id}`} onClick={() => void updateUser(user, { role: 'seller' })}>Approve seller</button>
                  <button type="button" disabled={busyKey === `user-${user.id}`} onClick={() => void updateUser(user, { seller_requested: false })}>Reject request</button>
                </>}
                {user.role === 'seller' && <button type="button" disabled={busyKey === `user-${user.id}`} onClick={() => void updateUser(user, { role: 'customer' })}>Revoke seller</button>}
                {user.role !== 'admin' && <button type="button" disabled={busyKey === `user-${user.id}`} onClick={() => void updateUser(user, { role: 'admin' })}>Make admin</button>}
                <button type="button" disabled={busyKey === `user-${user.id}`} onClick={() => void updateUser(user, { is_active: !user.is_active })}>{user.is_active ? 'Suspend' : 'Reinstate'}</button>
              </div>
            </article>)}
          </section>}

          {activeTab === 'categories' && <section className="seller-section admin-section">
            <h3>Product categories</h3>
            <form className="admin-category-form" onSubmit={(event) => { event.preventDefault(); void saveCategory() }}>
              <label>New category<input value={categoryName} onChange={(event) => setCategoryName(event.target.value)} maxLength={60} required /></label>
              <button className="dark-button" type="submit" disabled={busyKey === 'category-new'}>Add category <span aria-hidden="true">↗</span></button>
            </form>
            {categories.map((category) => <article className="admin-row" key={category.id}>
              <div className="admin-row-copy"><strong>{category.name}</strong><small>{category.product_count} product{category.product_count === 1 ? '' : 's'}</small></div>
              <div className="admin-row-actions">
                <button type="button" disabled={busyKey === `category-${category.id}`} onClick={() => void saveCategory(category)}>Rename</button>
                <button type="button" disabled={busyKey === `category-${category.id}`} onClick={() => void deleteCategory(category)}>Delete</button>
              </div>
            </article>)}
          </section>}

          {activeTab === 'orders' && <section className="seller-section admin-section">
            <h3>Platform orders</h3>
            {orders.map((order) => <article className="admin-row" key={order.id}>
              <div className="admin-row-copy"><strong>{order.order_number}</strong><span>{order.customer_email} · {new Date(order.created_at).toLocaleDateString()}</span><small>{order.payment_status} · {order.status} · {order.item_count} item{order.item_count === 1 ? '' : 's'}</small></div>
              <b>KSh {Number(order.total_amount).toLocaleString('en-KE')}</b>
            </article>)}
            {orders.length === 0 && <p className="seller-empty">No orders yet.</p>}
          </section>}

          {activeTab === 'products' && <section className="seller-section admin-section">
            <h3>Product moderation</h3>
            {products.map((product) => <article className="admin-row" key={product.id}>
              <div className="admin-row-copy"><strong>{product.name}</strong><span>{product.store_name} · {product.seller_email}</span><small>{product.category} · KSh {Number(product.price).toLocaleString('en-KE')} · {product.stock_quantity} in stock · {product.is_suspended ? 'suspended' : product.is_active ? 'live' : 'paused'}</small></div>
              <button type="button" disabled={busyKey === `product-${product.id}`} onClick={() => void suspendProduct(product)}>{product.is_suspended ? 'Reinstate' : 'Suspend'}</button>
            </article>)}
            {products.length === 0 && <p className="seller-empty">No products to review.</p>}
          </section>}
        </>}
      </section>
    </div>
  )
}

export default AdminStudio

import { useEffect, useState } from 'react'
import './App.css'
import SellerStudio from './SellerStudio'

type Product = {
  id: number
  name: string
  category: string
  price: string
  description: string
  image: string
  badge?: string
  average_rating?: number | null
  review_count?: number
  previewOnly?: boolean
}

type ProductReview = {
  id: number
  rating: number
  comment: string
  created_at: string
  reviewer_name: string
}

type CustomerOrder = {
  id: number
  order_number: string
  status: string
  payment_status: string
  payment_result_description?: string
  created_at: string
  total_amount: string
  items: Array<{
    id: number
    product: number
    product_name: string
    quantity: number
    unit_price: string
    fulfillment_status: string
    can_review: boolean
  }>
}

const previewProducts: Product[] = [
  { id: 1, name: 'Everyday Ceramic Set', category: 'Home', price: '5400', description: 'Hand-finished stoneware for the slow mornings.', image: 'photo-1610701596007-11502861dcfa', badge: 'Bestseller' },
  { id: 2, name: 'Market Tote No. 04', category: 'Accessories', price: '3600', description: 'A sturdy carryall made for the long way home.', image: 'photo-1590874103328-eac38a683ce7' },
  { id: 3, name: 'Botanical Study Print', category: 'Art', price: '4700', description: 'Archival ink on softly textured cotton paper.', image: 'photo-1579783902614-a3fb3927b6a5', badge: 'Small batch' },
  { id: 4, name: 'Form Candle, No. 2', category: 'Home', price: '3100', description: 'Cedar, fig leaf, and a little room to breathe.', image: 'photo-1603006905003-be475563bc59' },
  { id: 5, name: 'Ridge Glass Carafe', category: 'Home', price: '6200', description: 'Recycled glass with a satisfying, weighty feel.', image: 'photo-1514228742587-6b1558fcca3d' },
  { id: 6, name: 'Softline Scarf', category: 'Accessories', price: '7500', description: 'Light merino, woven close and finished by hand.', image: 'photo-1601924994987-69e26d50dc26' },
]

const categories = ['All finds', 'Home', 'Accessories', 'Art']
const previewCatalog = previewProducts.map((product) => ({ ...product, previewOnly: true }))
const defaultApiBaseUrl = import.meta.env.DEV ? '' : 'https://market-flow-backend.vercel.app'
const apiBaseUrl = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') ?? defaultApiBaseUrl

async function loadCatalog(): Promise<Product[]> {
  const response = await fetch(`${apiBaseUrl}/api/products/`)
  if (!response.ok) throw new Error('Catalog unavailable')
  const data = await response.json() as Product[]
  return data.length ? data.map((product, index) => ({ ...product, image: product.image || previewProducts[index % previewProducts.length].image, previewOnly: false })) : previewCatalog
}

function App() {
  const [products, setProducts] = useState<Product[]>(previewCatalog)
  const [activeCategory, setActiveCategory] = useState('All finds')
  const [search, setSearch] = useState('')
  const [cart, setCart] = useState<Record<number, number>>({})
  const [cartOpen, setCartOpen] = useState(false)
  const [phoneNumber, setPhoneNumber] = useState('')
  const [checkingOut, setCheckingOut] = useState(false)
  const [paymentOrderId, setPaymentOrderId] = useState<number | null>(null)
  const [paymentStatus, setPaymentStatus] = useState('')
  const [ordersOpen, setOrdersOpen] = useState(false)
  const [orders, setOrders] = useState<CustomerOrder[]>([])
  const [ordersLoading, setOrdersLoading] = useState(false)
  const [reviewsProduct, setReviewsProduct] = useState<Product | null>(null)
  const [reviews, setReviews] = useState<ProductReview[]>([])
  const [reviewsLoading, setReviewsLoading] = useState(false)
  const [reviewEligible, setReviewEligible] = useState(false)
  const [reviewRating, setReviewRating] = useState(5)
  const [reviewComment, setReviewComment] = useState('')
  const [reviewSubmitting, setReviewSubmitting] = useState(false)
  const [authOpen, setAuthOpen] = useState(false)
  const [registering, setRegistering] = useState(false)
  const [notice, setNotice] = useState('')
  const [token, setToken] = useState(() => localStorage.getItem('marketflow_access'))
  const [sellerStudioOpen, setSellerStudioOpen] = useState(false)
  const cartCount = Object.values(cart).reduce((total, quantity) => total + quantity, 0)

  async function refreshCatalog() {
    try {
      setProducts(await loadCatalog())
    } catch {
      setProducts(previewCatalog)
    }
  }

  async function openOrders() {
    if (!token) {
      setAuthOpen(true)
      return
    }
    setOrdersOpen(true)
    setOrdersLoading(true)
    try {
      const response = await fetch(`${apiBaseUrl}/api/orders/`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.detail || 'Could not load your orders.')
      setOrders(data as CustomerOrder[])
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not load your orders.')
    } finally {
      setOrdersLoading(false)
    }
  }

  async function openReviews(product: Product, canReview = false) {
    setReviewsProduct(product)
    setReviews([])
    setReviewEligible(canReview)
    setReviewRating(5)
    setReviewComment('')
    setReviewsLoading(true)
    try {
      const response = await fetch(`${apiBaseUrl}/api/products/${product.id}/reviews/`)
      const data = await response.json()
      if (!response.ok) throw new Error(data.detail || 'Could not load product reviews.')
      setReviews(data as ProductReview[])
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not load product reviews.')
    } finally {
      setReviewsLoading(false)
    }
  }

  async function submitReview(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!reviewsProduct || !token) return
    setReviewSubmitting(true)
    try {
      const response = await fetch(`${apiBaseUrl}/api/products/${reviewsProduct.id}/reviews/`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ rating: reviewRating, comment: reviewComment }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.detail || data.rating?.[0] || 'Could not submit your review.')
      setReviews((current) => [data as ProductReview, ...current])
      setReviewEligible(false)
      setReviewComment('')
      await refreshCatalog()
      setNotice('Thanks for sharing your review.')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not submit your review.')
    } finally {
      setReviewSubmitting(false)
    }
  }

  useEffect(() => {
    let active = true
    void loadCatalog()
      .then((data) => { if (active) setProducts(data) })
      .catch(() => { if (active) setProducts(previewCatalog) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (paymentOrderId === null || !token) return
    let active = true
    const checkPayment = async () => {
      try {
        const response = await fetch(`${apiBaseUrl}/api/orders/${paymentOrderId}/`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!response.ok) throw new Error('Could not check payment status.')
        const order = await response.json() as {
          payment_status: string
          payment_result_description?: string
          order_number: string
          items?: Array<{ product: number; quantity: number }>
        }
        if (!active) return
        setPaymentStatus(order.payment_status)
        if (order.payment_status === 'paid') setNotice(`Payment received. Order ${order.order_number} is confirmed.`)
        if (order.payment_status === 'failed') {
          setNotice(order.payment_result_description || 'M-Pesa payment was not completed.')
          setCart((current) => {
            const restored = { ...current }
            for (const item of order.items || []) restored[item.product] = (restored[item.product] || 0) + item.quantity
            return restored
          })
        }
        if (order.payment_status === 'paid' || order.payment_status === 'failed') window.clearInterval(timer)
      } catch (error) {
        if (active) setNotice(error instanceof Error ? error.message : 'Could not check payment status.')
      }
    }
    const timer = window.setInterval(() => { void checkPayment() }, 3000)
    void checkPayment()
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [paymentOrderId, token])

  const filteredProducts = products.filter((product) => {
    const matchesCategory = activeCategory === 'All finds' || product.category === activeCategory
    const matchesSearch = `${product.name} ${product.description} ${product.category}`.toLowerCase().includes(search.toLowerCase())
    return matchesCategory && matchesSearch
  })

  async function submitAuth(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const passwordConfirmation = formData.get('confirm_password')
    if (registering && formData.get('password') !== passwordConfirmation) {
      setNotice('Passwords do not match.')
      return
    }
    formData.delete('confirm_password')
    const payload = Object.fromEntries(formData.entries())
    const endpoint = `${apiBaseUrl}${registering ? '/api/auth/register/' : '/api/auth/login/'}`
    setNotice('')

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await response.json()
      if (!response.ok) {
        const messages = Object.values(data)
          .flatMap((value) => Array.isArray(value) ? value : [value])
          .filter((value): value is string => typeof value === 'string')
        setNotice(messages.join(' ') || 'Please check your details and try again.')
        return
      }
      if (data.access) {
        localStorage.setItem('marketflow_access', data.access)
        setToken(data.access)
      }
      setAuthOpen(false)
      setNotice(registering ? 'Your account is ready.' : 'Welcome back.')
    } catch {
      setNotice('The MarketFlow API is not available yet. Please try again shortly.')
    }
  }

  function signOut() {
    localStorage.removeItem('marketflow_access')
    setToken(null)
    setSellerStudioOpen(false)
    setNotice('You have signed out.')
  }

  async function checkout(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (Object.keys(cart).some((productId) => products.find((product) => product.id === Number(productId))?.previewOnly)) {
      setNotice('Preview items can’t be purchased yet. Add a live seller listing to enable checkout.')
      return
    }
    if (!token) {
      setAuthOpen(true)
      return
    }
    setCheckingOut(true)
    setNotice('')
    try {
      const response = await fetch(`${apiBaseUrl}/api/orders/checkout/`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          phone_number: phoneNumber,
          items: Object.entries(cart).map(([productId, quantity]) => ({
            product_id: Number(productId),
            quantity,
          })),
        }),
      })
      const data = await response.json()
      if (!response.ok) {
        const messages = Object.values(data)
          .flatMap((value) => Array.isArray(value) ? value : [value])
          .filter((value): value is string => typeof value === 'string')
        throw new Error(messages.join(' ') || 'Could not start M-Pesa checkout.')
      }
      setPaymentOrderId(data.id)
      setPaymentStatus(data.payment_status)
      setCart({})
      setNotice(data.payment_message || 'Check your phone to complete the M-Pesa payment.')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not start M-Pesa checkout.')
    } finally {
      setCheckingOut(false)
    }
  }

  return (
      <main>
        <div className="announcement">Independent makers, good things, delivered. <span>Free shipping over KSh 10,000</span></div>
        <header className="site-header">
          <a className="wordmark" href="#top" aria-label="MarketFlow home">market<span>flow</span><i>.</i></a>
          <nav className="main-nav" aria-label="Main navigation">
            <a href="#discover">Discover</a>
            <a href="#discover" onClick={() => setActiveCategory('Home')}>Home goods</a>
            <a href="#discover" onClick={() => setActiveCategory('Accessories')}>Accessories</a>
          </nav>
          <div className="header-actions">
            {token ? <>
              <button className="text-action" onClick={() => void openOrders()}>My orders</button>
              <button className="text-action" onClick={() => setSellerStudioOpen(true)}>Seller studio</button>
              <button className="text-action" onClick={signOut}>Sign out</button>
            </> : <button className="text-action" onClick={() => setAuthOpen(true)}>Sign in</button>}
            <button className="cart-button" aria-label={`Shopping bag with ${cartCount} items`} onClick={() => setCartOpen(true)}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h14l1 13H4L5 8Z"/><path d="M9 9V6a3 3 0 0 1 6 0v3"/></svg>
              <span>Bag <b>{cartCount}</b></span>
            </button>
          </div>
        </header>

        <section className="hero" id="top">
          <div className="hero-copy">
            <p className="eyebrow">THE GOOD-FIND MARKET</p>
            <h1>Keep good<br/>things <em>close.</em></h1>
            <p className="hero-description">A considered collection from independent makers. Useful things, made with care, that feel right at home.</p>
            <a className="dark-button" href="#discover">Explore the market <span aria-hidden="true">↘</span></a>
            <div className="hero-note"><span className="note-dot"/> Made slowly. Chosen thoughtfully.</div>
          </div>
          <div className="hero-image" role="img" aria-label="Handmade ceramics arranged on a warm studio table">
            <div className="image-caption"><span>OBJECTS FOR EVERYDAY RITUALS</span><span>01 / 04</span></div>
          </div>
          <div className="hero-index">MF—001</div>
        </section>

        <section className="maker-strip" aria-label="Market values">
          <span>INDEPENDENT BY NATURE</span><i/>
          <span>BUILT TO BE KEPT</span><i/>
          <span>GOOD PEOPLE, GOOD GOODS</span><i/>
          <span>SMALL BATCH ALWAYS</span>
        </section>

        <section className="market-section" id="discover">
          <div className="section-heading">
            <div><p className="eyebrow">A FEW THINGS WE LOVE</p><h2>The market <span>edit</span></h2></div>
            <p className="section-aside">Every piece has a person<br/>and a point of view behind it.</p>
          </div>
          <div className="market-controls">
            <div className="category-tabs" role="tablist" aria-label="Product categories">
              {categories.map((category) => <button key={category} role="tab" aria-selected={activeCategory === category} className={activeCategory === category ? 'active' : ''} onClick={() => setActiveCategory(category)}>{category}</button>)}
            </div>
            <label className="search-field"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.3"/><path d="m16 16 4.2 4.2"/></svg><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find something" aria-label="Search products"/></label>
          </div>
          <div className="product-grid">
            {filteredProducts.map((product, index) => <article className="product" key={product.id} style={{ animationDelay: `${index * 70}ms` }}>
              <div className="product-image-wrap">
                <img src={product.image.startsWith('http') ? product.image : `https://images.unsplash.com/${product.image}?auto=format&fit=crop&w=900&q=85`} alt={product.name}/>
                {product.badge && <span className="product-badge">{product.badge}</span>}
                <button className="add-button" aria-label={`Add ${product.name} to bag`} onClick={() => {
                  setCart((current) => ({ ...current, [product.id]: (current[product.id] || 0) + 1 }))
                  setNotice(`${product.name} added to your bag.`)
                }}><span aria-hidden="true">+</span> Add to bag</button>
              </div>
              <div className="product-meta"><div><p className="product-category">{product.category}</p><h3>{product.name}</h3></div><span className="price">KSh {Number(product.price).toLocaleString('en-KE', { maximumFractionDigits: 0 })}</span></div>
              <div className="product-reviews">
                <span>{product.review_count ? `★ ${Number(product.average_rating).toFixed(1)} · ${product.review_count} review${product.review_count === 1 ? '' : 's'}` : 'No reviews yet'}</span>
                <button type="button" disabled={product.previewOnly} onClick={() => void openReviews(product)}>Reviews</button>
              </div>
              <p className="product-description">{product.description}</p>
            </article>)}
          </div>
          {products.every((product) => product.previewOnly) && <p className="catalog-notice">These are preview listings. Sign in and publish your own products to start selling.</p>}
          {filteredProducts.length === 0 && <p className="empty-state">No finds match that search. Try another name or category.</p>}
          <div className="market-footer"><span>SHOWING {filteredProducts.length} FINDS</span><a href="#top">Back to top ↑</a></div>
        </section>

        <footer className="site-footer"><a className="wordmark" href="#top">market<span>flow</span><i>.</i></a><p>A little more meaning in the everyday.</p><span>© 2026 MARKETFLOW</span></footer>

        {notice && <div className="toast" role="status"><span>{notice}</span><button aria-label="Dismiss message" onClick={() => setNotice('')}>×</button></div>}
        {cartOpen && <div className="modal-backdrop" onClick={(event) => { if (event.target === event.currentTarget) setCartOpen(false) }}>
          <section className="auth-modal cart-modal" aria-labelledby="cart-title">
            <button className="modal-close" aria-label="Close shopping bag" onClick={() => setCartOpen(false)}>×</button>
            <p className="eyebrow">YOUR GOOD FINDS</p><h2 id="cart-title">Shopping bag</h2>
            {cartCount === 0 ? <p>{paymentOrderId ? `Order payment status: ${paymentStatus || 'checking'}.` : 'Your bag is empty for now.'}</p> : <>
              <div className="cart-items">
                {Object.entries(cart).map(([productId, quantity]) => {
                  const product = products.find((item) => item.id === Number(productId))
                  if (!product) return null
                  return <div className="cart-item" key={productId}>
                    <div><strong>{product.name}</strong><span>KSh {Number(product.price).toLocaleString('en-KE')} each</span></div>
                    <div className="cart-quantity">
                      <button type="button" aria-label={`Remove one ${product.name}`} onClick={() => setCart((current) => {
                        const next = { ...current }
                        if (next[product.id] <= 1) delete next[product.id]
                        else next[product.id] -= 1
                        return next
                      })}>−</button>
                      <span>{quantity}</span>
                      <button type="button" aria-label={`Add one ${product.name}`} onClick={() => setCart((current) => ({ ...current, [product.id]: current[product.id] + 1 }))}>+</button>
                    </div>
                  </div>
                })}
              </div>
              <p className="cart-total"><span>Total</span><strong>KSh {Object.entries(cart).reduce((total, [productId, quantity]) => total + Number(products.find((product) => product.id === Number(productId))?.price || 0) * quantity, 0).toLocaleString('en-KE')}</strong></p>
              {Object.keys(cart).some((productId) => products.find((product) => product.id === Number(productId))?.previewOnly)
                ? <p className="catalog-notice">Preview items can’t be purchased yet. Live seller listings will be available to checkout.</p>
                : !token ? <button className="dark-button" type="button" onClick={() => setAuthOpen(true)}>Sign in to checkout <span aria-hidden="true">↗</span></button> : <form onSubmit={checkout}>
                <label>M-Pesa phone number<input type="tel" value={phoneNumber} onChange={(event) => setPhoneNumber(event.target.value)} placeholder="+254 7XX XXX XXX" autoComplete="tel" required /></label>
                <button className="dark-button" type="submit" disabled={checkingOut || paymentStatus === 'pending'}>{checkingOut ? 'Starting payment…' : 'Pay with M-Pesa'} <span aria-hidden="true">↗</span></button>
                {paymentOrderId && paymentStatus === 'pending' && <p role="status">M-Pesa prompt sent. Check your phone and enter your PIN.</p>}
              </form>}
            </>}
          </section>
        </div>}
        {ordersOpen && <div className="modal-backdrop" onClick={(event) => { if (event.target === event.currentTarget) setOrdersOpen(false) }}>
          <section className="auth-modal account-modal" aria-labelledby="orders-title">
            <button className="modal-close" aria-label="Close orders" onClick={() => setOrdersOpen(false)}>×</button>
            <p className="eyebrow">YOUR MARKETFLOW ACCOUNT</p><h2 id="orders-title">My orders</h2>
            {ordersLoading ? <p role="status">Loading your orders…</p> : orders.length === 0
              ? <p>Your orders will appear here after checkout.</p>
              : <div className="customer-orders">{orders.map((order) => {
                const trackingStages = ['paid', 'processing', 'shipped', 'delivered']
                const currentStage = trackingStages.indexOf(order.status)
                const statusLabel = order.status.replaceAll('_', ' ')
                return <article className="customer-order" key={order.id}>
                  <header>
                    <div><span className="order-label">ORDER</span><strong>{order.order_number}</strong></div>
                    <span className={`order-status order-status-${order.payment_status}`}>{order.payment_status.replaceAll('_', ' ')}</span>
                  </header>
                  <p className="order-date">{new Date(order.created_at).toLocaleDateString()}</p>
                  {currentStage >= 0 ? <div className="order-tracking" aria-label={`Order tracking: ${statusLabel}`}>
                    {['Confirmed', 'Preparing', 'On the way', 'Delivered'].map((stage, index) => <span className={index <= currentStage ? 'complete' : ''} key={stage}>{stage}</span>)}
                  </div> : <p className="order-tracking-message">{order.payment_status === 'pending' ? 'Complete the M-Pesa prompt to confirm this order.' : order.payment_status === 'failed' ? order.payment_result_description || 'Payment was not completed.' : `Order status: ${statusLabel}.`}</p>}
                  <div className="customer-order-items">{order.items.map((item) => <div key={item.id}>
                    <span>{item.product_name} × {item.quantity} <em>{item.fulfillment_status}</em></span>
                    {item.can_review && <button type="button" onClick={() => {
                      const product = products.find((entry) => entry.id === item.product)
                      if (product) void openReviews(product, true)
                    }}>Write a review</button>}
                  </div>)}</div>
                  <p className="order-total"><span>Total</span><strong>KSh {Number(order.total_amount).toLocaleString('en-KE')}</strong></p>
                </article>
              })}</div>}
          </section>
        </div>}
        {reviewsProduct && <div className="modal-backdrop" onClick={(event) => { if (event.target === event.currentTarget) setReviewsProduct(null) }}>
          <section className="auth-modal account-modal" aria-labelledby="reviews-title">
            <button className="modal-close" aria-label="Close reviews" onClick={() => setReviewsProduct(null)}>×</button>
            <p className="eyebrow">CUSTOMER NOTES</p><h2 id="reviews-title">{reviewsProduct.name}</h2>
            {reviewsLoading ? <p role="status">Loading reviews…</p> : reviews.length === 0
              ? <p>No reviews yet. Be the first to share your experience after purchase.</p>
              : <div className="review-list">{reviews.map((review) => <article key={review.id}>
                <div><span className="review-stars" aria-label={`${review.rating} out of 5 stars`}>{'★'.repeat(review.rating)}{'☆'.repeat(5 - review.rating)}</span><time>{new Date(review.created_at).toLocaleDateString()}</time></div>
                <strong>{review.reviewer_name || 'MarketFlow customer'}</strong>
                {review.comment && <p>{review.comment}</p>}
              </article>)}</div>}
            {reviewEligible && token && <form className="review-form" onSubmit={submitReview}>
              <h3>Share your review</h3>
              <label>Rating<select value={reviewRating} onChange={(event) => setReviewRating(Number(event.target.value))}>
                {[5, 4, 3, 2, 1].map((rating) => <option value={rating} key={rating}>{rating} {rating === 1 ? 'star' : 'stars'}</option>)}
              </select></label>
              <label>Your note<textarea value={reviewComment} onChange={(event) => setReviewComment(event.target.value)} maxLength={1000} rows={3} placeholder="What did you think?" /></label>
              <button className="dark-button" type="submit" disabled={reviewSubmitting}>{reviewSubmitting ? 'Submitting…' : 'Submit review'} <span aria-hidden="true">↗</span></button>
            </form>}
          </section>
        </div>}
        {authOpen && <div className="modal-backdrop" onClick={(event) => { if (event.target === event.currentTarget) setAuthOpen(false) }}>
          <section className="auth-modal" aria-labelledby="auth-title">
            <button className="modal-close" aria-label="Close sign in" onClick={() => setAuthOpen(false)}>×</button>
            <p className="eyebrow">GOOD TO HAVE YOU HERE</p><h2 id="auth-title">{registering ? 'Join the market.' : 'Welcome back.'}</h2>
            <form onSubmit={submitAuth}>
              {registering && <label>Name<input name="first_name" autoComplete="given-name" required/></label>}
              <label>Email<input name="email" type="email" autoComplete="email" required/></label>
              <label>Password<input name="password" type="password" autoComplete={registering ? 'new-password' : 'current-password'} minLength={8} required/></label>
              {registering && <label>Confirm password<input name="confirm_password" type="password" autoComplete="new-password" minLength={8} required/></label>}
              <button className="dark-button" type="submit">{registering ? 'Create account' : 'Sign in'} <span aria-hidden="true">↗</span></button>
            </form>
            <button className="switch-auth" onClick={() => setRegistering((value) => !value)}>{registering ? 'Already have an account? Sign in' : 'New around here? Create an account'}</button>
          </section>
        </div>}
        {sellerStudioOpen && token && <SellerStudio
          apiBaseUrl={apiBaseUrl}
          token={token}
          onClose={() => setSellerStudioOpen(false)}
          onCatalogChanged={refreshCatalog}
          onNotice={setNotice}
        />}
      </main>
    )
  }

  export default App
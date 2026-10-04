import { useEffect, useState } from 'react'
import './App.css'

type Product = {
  id: number
  name: string
  category: string
  price: string
  description: string
  image: string
  badge?: string
}

const previewProducts: Product[] = [
  { id: 1, name: 'Everyday Ceramic Set', category: 'Home', price: '42.00', description: 'Hand-finished stoneware for the slow mornings.', image: 'photo-1610701596007-11502861dcfa', badge: 'Bestseller' },
  { id: 2, name: 'Market Tote No. 04', category: 'Accessories', price: '28.00', description: 'A sturdy carryall made for the long way home.', image: 'photo-1590874103328-eac38a683ce7' },
  { id: 3, name: 'Botanical Study Print', category: 'Art', price: '36.00', description: 'Archival ink on softly textured cotton paper.', image: 'photo-1579783902614-a3fb3927b6a5', badge: 'Small batch' },
  { id: 4, name: 'Form Candle, No. 2', category: 'Home', price: '24.00', description: 'Cedar, fig leaf, and a little room to breathe.', image: 'photo-1603006905003-be475563bc59' },
  { id: 5, name: 'Ridge Glass Carafe', category: 'Home', price: '48.00', description: 'Recycled glass with a satisfying, weighty feel.', image: 'photo-1514228742587-6b1558fcca3d' },
  { id: 6, name: 'Softline Scarf', category: 'Accessories', price: '58.00', description: 'Light merino, woven close and finished by hand.', image: 'photo-1601924994987-69e26d50dc26' },
]

const categories = ['All finds', 'Home', 'Accessories', 'Art']
const apiBaseUrl = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') ?? ''

function App() {
  const [products, setProducts] = useState<Product[]>(previewProducts)
  const [activeCategory, setActiveCategory] = useState('All finds')
  const [search, setSearch] = useState('')
  const [cartCount, setCartCount] = useState(0)
  const [authOpen, setAuthOpen] = useState(false)
  const [registering, setRegistering] = useState(false)
  const [notice, setNotice] = useState('')
  const [token, setToken] = useState(() => localStorage.getItem('marketflow_access'))

  useEffect(() => {
    fetch(`${apiBaseUrl}/api/products/`)
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((data: Product[]) => setProducts(data.length ? data.map((product, index) => ({ ...product, image: product.image || previewProducts[index % previewProducts.length].image })) : previewProducts))
      .catch(() => setProducts(previewProducts))
  }, [])

  const filteredProducts = products.filter((product) => {
    const matchesCategory = activeCategory === 'All finds' || product.category === activeCategory
    const matchesSearch = `${product.name} ${product.description} ${product.category}`.toLowerCase().includes(search.toLowerCase())
    return matchesCategory && matchesSearch
  })

  async function submitAuth(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
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
        setNotice(typeof data.detail === 'string' ? data.detail : 'Please check your details and try again.')
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
    setNotice('You have signed out.')
  }

  return (
    <main>
      <div className="announcement">Independent makers, good things, delivered. <span>Free shipping over $75</span></div>
      <header className="site-header">
        <a className="wordmark" href="#top" aria-label="MarketFlow home">market<span>flow</span><i>.</i></a>
        <nav className="main-nav" aria-label="Main navigation">
          <a href="#discover">Discover</a>
          <a href="#discover" onClick={() => setActiveCategory('Home')}>Home goods</a>
          <a href="#discover" onClick={() => setActiveCategory('Accessories')}>Accessories</a>
        </nav>
        <div className="header-actions">
          {token ? <button className="text-action" onClick={signOut}>Sign out</button> : <button className="text-action" onClick={() => setAuthOpen(true)}>Sign in</button>}
          <button className="cart-button" aria-label={`Shopping bag with ${cartCount} items`} onClick={() => setNotice(cartCount ? `${cartCount} item${cartCount === 1 ? '' : 's'} in your bag.` : 'Your bag is empty for now.')}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h14l1 13H4L5 8Z"/><path d="M9 9V6a3 3 0 0 1 6 0v3"/></svg>
            <span>Bag <b>{cartCount}</b></span>
          </button>
        </div>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow">THE GOOD-FIND MARKET</p>
          <h1>Keep good<br />things <em>close.</em></h1>
          <p className="hero-description">A considered collection from independent makers. Useful things, made with care, that feel right at home.</p>
          <a className="dark-button" href="#discover">Explore the market <span aria-hidden="true">↘</span></a>
          <div className="hero-note"><span className="note-dot" /> Made slowly. Chosen thoughtfully.</div>
        </div>
        <div className="hero-image" role="img" aria-label="Handmade ceramics arranged on a warm studio table">
          <div className="image-caption"><span>OBJECTS FOR EVERYDAY RITUALS</span><span>01 / 04</span></div>
        </div>
        <div className="hero-index">MF—001</div>
      </section>

      <section className="maker-strip" aria-label="Market values">
        <span>INDEPENDENT BY NATURE</span><i />
        <span>BUILT TO BE KEPT</span><i />
        <span>GOOD PEOPLE, GOOD GOODS</span><i />
        <span>SMALL BATCH ALWAYS</span>
      </section>

      <section className="market-section" id="discover">
        <div className="section-heading">
          <div><p className="eyebrow">A FEW THINGS WE LOVE</p><h2>The market <span>edit</span></h2></div>
          <p className="section-aside">Every piece has a person<br />and a point of view behind it.</p>
        </div>
        <div className="market-controls">
          <div className="category-tabs" role="tablist" aria-label="Product categories">
            {categories.map((category) => <button key={category} role="tab" aria-selected={activeCategory === category} className={activeCategory === category ? 'active' : ''} onClick={() => setActiveCategory(category)}>{category}</button>)}
          </div>
          <label className="search-field"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.3"/><path d="m16 16 4.2 4.2"/></svg><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find something" aria-label="Search products" /></label>
        </div>
        <div className="product-grid">
          {filteredProducts.map((product, index) => <article className="product" key={product.id} style={{ animationDelay: `${index * 70}ms` }}>
            <div className="product-image-wrap">
              <img src={product.image.startsWith('http') ? product.image : `https://images.unsplash.com/${product.image}?auto=format&fit=crop&w=900&q=85`} alt={product.name} />
              {product.badge && <span className="product-badge">{product.badge}</span>}
              <button className="add-button" aria-label={`Add ${product.name} to bag`} onClick={() => setCartCount((count) => count + 1)}>+</button>
            </div>
            <div className="product-meta"><div><p className="product-category">{product.category}</p><h3>{product.name}</h3></div><span className="price">${product.price}</span></div>
            <p className="product-description">{product.description}</p>
          </article>)}
        </div>
        {filteredProducts.length === 0 && <p className="empty-state">No finds match that search. Try another name or category.</p>}
        <div className="market-footer"><span>SHOWING {filteredProducts.length} FINDS</span><a href="#top">Back to top ↑</a></div>
      </section>

      <footer className="site-footer"><a className="wordmark" href="#top">market<span>flow</span><i>.</i></a><p>A little more meaning in the everyday.</p><span>© 2026 MARKETFLOW</span></footer>

      {notice && <div className="toast" role="status"><span>{notice}</span><button aria-label="Dismiss message" onClick={() => setNotice('')}>×</button></div>}
      {authOpen && <div className="modal-backdrop" onClick={(event) => { if (event.target === event.currentTarget) setAuthOpen(false) }}>
        <section className="auth-modal" aria-labelledby="auth-title">
          <button className="modal-close" aria-label="Close sign in" onClick={() => setAuthOpen(false)}>×</button>
          <p className="eyebrow">GOOD TO HAVE YOU HERE</p><h2 id="auth-title">{registering ? 'Join the market.' : 'Welcome back.'}</h2>
          <form onSubmit={submitAuth}>
            {registering && <label>Name<input name="first_name" autoComplete="given-name" required /></label>}
            <label>Email<input name="email" type="email" autoComplete="email" required /></label>
            <label>Password<input name="password" type="password" autoComplete={registering ? 'new-password' : 'current-password'} minLength={8} required /></label>
            <button className="dark-button" type="submit">{registering ? 'Create account' : 'Sign in'} <span aria-hidden="true">↗</span></button>
          </form>
          <button className="switch-auth" onClick={() => setRegistering((value) => !value)}>{registering ? 'Already have an account? Sign in' : 'New around here? Create an account'}</button>
        </section>
      </div>}
    </main>
  )
}

export default App
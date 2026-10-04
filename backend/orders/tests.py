from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APITestCase

from orders.models import Order, OrderItem
from payments.models import Payment
from products.models import Product
from stores.models import Store

User = get_user_model()


class OrderModelTests(TestCase):
	def test_order_total_uses_saved_unit_price_and_payment_links_to_order(self):
		customer = User.objects.create_user(username='buyer', password='A-strong-pass-123')
		owner = User.objects.create_user(username='maker', password='A-strong-pass-123')
		store = Store.objects.create(owner=owner, name='Good Things', slug='good-things')
		product = Product.objects.create(store=store, name='Cup', price='18.00', stock_quantity=5)
		order = Order.objects.create(customer=customer)
		OrderItem.objects.create(order=order, product=product, quantity=2, unit_price='15.00')
		product.price = Decimal('20.00')
		product.save()

		self.assertEqual(order.total_amount, Decimal('30.00'))
		self.assertEqual(order.currency, 'KES')

		payment = Payment.objects.create(order=order, amount=order.total_amount)
		self.assertEqual(order.payment, payment)
		self.assertEqual(payment.currency, 'KES')


class OrderApiTests(APITestCase):
	def setUp(self):
		self.customer = User.objects.create_user(username='buyer', password='A-strong-pass-123')
		self.other_customer = User.objects.create_user(username='other', password='A-strong-pass-123')
		owner = User.objects.create_user(username='maker', password='A-strong-pass-123')
		store = Store.objects.create(owner=owner, name='Good Things', slug='good-things')
		self.product = Product.objects.create(store=store, name='Cup', price='12.50', stock_quantity=4)

	def test_order_uses_server_price_and_decrements_stock(self):
		self.client.force_authenticate(self.customer)

		response = self.client.post(
			'/api/orders/',
			{'items': [{'product_id': self.product.id, 'quantity': 2}]},
			format='json',
		)

		self.assertEqual(response.status_code, 201)
		self.assertEqual(response.data['total_amount'], '25.00')
		self.product.refresh_from_db()
		self.assertEqual(self.product.stock_quantity, 2)

	def test_insufficient_stock_does_not_create_order_or_change_stock(self):
		self.client.force_authenticate(self.customer)

		response = self.client.post(
			'/api/orders/',
			{'items': [{'product_id': self.product.id, 'quantity': 5}]},
			format='json',
		)

		self.assertEqual(response.status_code, 400)
		self.assertEqual(Order.objects.count(), 0)
		self.product.refresh_from_db()
		self.assertEqual(self.product.stock_quantity, 4)

	def test_customers_only_see_their_own_orders(self):
		self.client.force_authenticate(self.customer)
		created = self.client.post(
			'/api/orders/',
			{'items': [{'product_id': self.product.id, 'quantity': 1}]},
			format='json',
		)
		order_id = created.data['id']

		self.client.force_authenticate(self.other_customer)
		self.assertEqual(self.client.get('/api/orders/').data, [])
		self.assertEqual(self.client.get(f'/api/orders/{order_id}/').status_code, 404)

	def test_order_placement_requires_authentication(self):
		response = self.client.post(
			'/api/orders/',
			{'items': [{'product_id': self.product.id, 'quantity': 1}]},
			format='json',
		)

		self.assertEqual(response.status_code, 401)

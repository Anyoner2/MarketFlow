import uuid
from decimal import Decimal

from django.conf import settings
from django.db import models


class Order(models.Model):
	class Status(models.TextChoices):
		PENDING = 'pending', 'Pending'
		PAID = 'paid', 'Paid'
		FULFILLED = 'fulfilled', 'Fulfilled'
		CANCELLED = 'cancelled', 'Cancelled'

	order_number = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
	customer = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='orders')
	status = models.CharField(max_length=16, choices=Status.choices, default=Status.PENDING)
	currency = models.CharField(max_length=3, default='KES')
	created_at = models.DateTimeField(auto_now_add=True)
	updated_at = models.DateTimeField(auto_now=True)

	class Meta:
		ordering = ['-created_at']

	def __str__(self):
		return str(self.order_number)

	@property
	def total_amount(self):
		return sum((item.unit_price * item.quantity for item in self.items.all()), start=Decimal('0.00'))


class OrderItem(models.Model):
	order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name='items')
	product = models.ForeignKey('products.Product', on_delete=models.PROTECT, related_name='order_items')
	quantity = models.PositiveIntegerField()
	unit_price = models.DecimalField(max_digits=10, decimal_places=2)

	class Meta:
		constraints = [
			models.UniqueConstraint(fields=['order', 'product'], name='unique_product_per_order'),
		]

	def __str__(self):
		return f'{self.quantity} x {self.product.name}'

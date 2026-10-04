from rest_framework import generics
from rest_framework.permissions import IsAuthenticated

from .models import Order
from .serializers import OrderCreateSerializer, OrderSerializer


class OrderListCreateView(generics.ListCreateAPIView):
	permission_classes = [IsAuthenticated]

	def get_queryset(self):
		return Order.objects.filter(customer=self.request.user).prefetch_related('items__product')

	def get_serializer_class(self):
		if self.request.method == 'POST':
			return OrderCreateSerializer
		return OrderSerializer

	def get_serializer_context(self):
		return super().get_serializer_context()


class OrderDetailView(generics.RetrieveAPIView):
	permission_classes = [IsAuthenticated]
	serializer_class = OrderSerializer

	def get_queryset(self):
		return Order.objects.filter(customer=self.request.user).prefetch_related('items__product')
